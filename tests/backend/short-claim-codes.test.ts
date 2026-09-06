import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import { claimError } from "../../convex/_claimErrors";
import { claimErrorMessage, claimFailureOutcome } from "../../apps/web/src/lib/claim-errors";
import schemaModule from "../../convex/schema";
import { clerkTestIdentity, newClerkUserId } from "./_clerkTestIdentity";
import { VrchatClient } from "../../workers/group-telemetry/vrchat-client.mjs";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profileClaims.ts": () => import("../../convex/profileClaims"),
  "../../convex/communityTelemetry.ts": () => import("../../convex/communityTelemetry"),
  "../../convex/claimAnalytics.ts": () => import("../../convex/claimAnalytics"),
  "../../convex/claimAnalyticsDelivery.ts": () => import("../../convex/claimAnalyticsDelivery"),
};
const DAY = 86_400_000;
const target = "usr_01234567-89ab-cdef-0123-456789abcdef";

async function fixture(targetType: "vrchat_user" | "vrchat_group" | "vrclinking" = "vrchat_user") {
  const t = convexTest({ schema, modules });
  const clerkUserId = newClerkUserId();
  const now = Date.now();
  const ids = await t.run(async ({ db }) => {
    const userId = await db.insert("users", { clerkUserId, email: "short-code@example.test", emailVerificationTime: now });
    const profileId = await db.insert("profiles", {
      profileType: targetType === "vrchat_group" ? "community" : "person",
      slug: "short-code", displayName: "Short Code", sortName: "short code", aliases: [], tags: [],
      claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public",
      creationSource: "concierge", updatedAt: now,
      ...(targetType === "vrchat_group" ? { community: { categoryTags: [] } } : { person: { roleTags: [] } }),
    });
    return { userId, profileId };
  });
  const args = {
    profileSlug: "short-code", targetType,
    targetExternalId: targetType === "vrchat_group" ? target.replace("usr_", "grp_") : target,
    analyticsJourneyId: "00000000-0000-4000-8000-000000000000",
  };
  const client = t.withIdentity(clerkTestIdentity(clerkUserId));
  const start = () => client.mutation(api.profileClaims.startVrchatProof, args);
  return { t, ids, args, start, now, client };
}

for (const targetType of ["vrchat_user", "vrchat_group"] as const) {
  it(`issues a padded short ${targetType} code and reuses it without extending expiry`, async (c) => {
    const f = await fixture(targetType);
    c.mock.method(crypto, "randomUUID", () => "00000007-0000-4000-8000-000000000000");
    const first = await f.start();
    assert.equal(first.proofCode, "VRDEX00007");
    const again = await f.start();
    assert.equal(again.attemptId, first.attemptId);
    assert.equal(again.expiresAt, first.expiresAt);
  });
}

it("keeps a pending legacy code and leaves VRCLinking issuance long", async () => {
  const f = await fixture();
  const first = await f.start();
  await f.t.run(({ db }) => db.patch(first.attemptId, { proofCode: "VRDEX-012345ABCDEF" }));
  assert.equal((await f.start()).proofCode, "VRDEX-012345ABCDEF");
  assert.match((await (await fixture("vrclinking")).start()).proofCode, /^VRDEX-[A-F0-9]{12}$/);
});

it("never reuses a historical target code and bounds collision retries", async (c) => {
  const f = await fixture();
  const first = await f.start();
  await f.t.run(({ db }) => db.patch(first.attemptId, {
    proofCode: "VRDEX00007", state: "expired", createdAt: f.now - 2 * DAY, expiresAt: f.now - DAY,
  }));
  const random = c.mock.method(crypto, "randomUUID", () => "00000007-0000-4000-8000-000000000000");
  await assert.rejects(f.start(), /ADAPTER_UNAVAILABLE/);
  assert.equal(random.mock.callCount(), 32);
  assert.equal((await f.t.run(({ db }) => db.query("profileVerificationAttempts").collect())).length, 1);
});

it("counts all recent target attempts at the cap while allowing pending reuse", async () => {
  const f = await fixture();
  const first = await f.start();
  await f.t.run(async ({ db }) => {
    for (let i = 0; i < 19; i++) await db.insert("profileVerificationAttempts", {
      ...f.ids, method: "vrchat_user_proof", targetType: "vrchat_user", targetExternalId: target,
      proofCode: `VRDEX-${i.toString().padStart(12, "0")}`, state: "failed",
      createdAt: f.now, updatedAt: f.now, expiresAt: f.now + DAY,
    });
  });
  assert.equal((await f.start()).attemptId, first.attemptId);
  await f.t.run(({ db }) => db.patch(first.attemptId, { state: "failed" }));
  await assert.rejects(f.start(), /PROOF_ISSUANCE_LIMIT/);
});

it("rejects biased draws, accepts the upper unbiased value, and bounds rejected draws", async (c) => {
  const f = await fixture();
  const values = [4_294_900_000, 4_294_967_295, 4_294_899_999];
  const random = c.mock.method(crypto, "randomUUID", () => `${(values.shift() ?? 4_294_967_295).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`);
  const first = await f.start();
  assert.equal(first.proofCode, "VRDEX99999");
  assert.equal(random.mock.callCount(), 3);
  await f.t.run(({ db }) => db.patch(first.attemptId, { state: "failed" }));
  await assert.rejects(f.start(), /ADAPTER_UNAVAILABLE/);
  assert.equal(random.mock.callCount(), 35);
});

for (const state of ["pending", "expired", "failed", "verified"] as const) {
  it(`reserves ${state} history across claimant changes but permits another target`, async (c) => {
    const f = await fixture();
    const first = await f.start();
    await f.t.run(async ({ db }) => {
      const otherUser = await db.insert("users", { clerkUserId: newClerkUserId(), email: "history@example.test" });
      await db.patch(first.attemptId, {
        userId: otherUser, proofCode: "VRDEX00007", state,
        createdAt: f.now - 2 * DAY, expiresAt: f.now - DAY,
      });
    });
    c.mock.method(crypto, "randomUUID", () => "00000007-0000-4000-8000-000000000000");
    await assert.rejects(f.start(), /ADAPTER_UNAVAILABLE/);
    f.args.targetExternalId = target.replace("01234567", "11234567");
    assert.equal((await f.start()).proofCode, "VRDEX00007");
  });
}

it("does not impose new account-wide daily or cooldown limits across targets", async () => {
  const f = await fixture();
  for (let i = 0; i < 22; i++) {
    f.args.targetExternalId = `usr_${i.toString().padStart(8, "0")}-89ab-cdef-0123-456789abcdef`;
    const issued = await f.start();
    assert.match(issued.proofCode, /^VRDEX[0-9]{5}$/);
    await f.t.run(({ db }) => db.patch(issued.attemptId, { state: "failed" }));
  }
});

for (const targetType of ["vrchat_user", "vrchat_group"] as const) {
  for (const legacy of [false, true]) {
    it(`completes a ${legacy ? "legacy" : "short"} ${targetType} proof through provider matching and collector recording`, async () => {
      const f = await fixture(targetType);
      const issued = await f.start();
      const code = legacy ? "VRDEX-012345ABCDEF" : issued.proofCode;
      if (legacy) await f.t.run(({ db }) => db.patch(issued.attemptId, { proofCode: code }));
      const collectorAccountId = await f.t.run(({ db }) => db.insert("collectorAccounts", {
        vrchatUserId: "usr_fixture-collector", accountAlias: "short-code-fixture", state: "ready",
        capacity: 100, reservedHeadroom: 15, assignedGroupCount: 0, requestsPerMinute: 30,
        secretRef: "secret://isolated-fixture", workerKeyHash: "a".repeat(64),
        credentialGeneration: 1, killSwitchEnabled: false, createdAt: f.now, updatedAt: f.now,
      }));
      const batch = await f.t.mutation(internal.communityTelemetry.claimPendingProofChecks, {
        collectorAccountId, workerId: "fixture-worker", limit: 5, now: Date.now(),
      });
      assert.equal(batch.attempts.length, 1);
      const attempt = batch.attempts[0]!;
      const urls: string[] = [];
      // Only the HTTP transport is synthetic; provider parsing and matching are production code.
      const provider = new VrchatClient({
        authCookie: "fixture-cookie", userAgent: "VRDexFixture/1", baseUrl: "https://provider.example.test",
        fetcher: async (url: string) => {
          urls.push(String(url));
          return new Response(JSON.stringify({
            [targetType === "vrchat_group" ? "description" : "bio"]: `Hello! (${code.toLowerCase()})`,
          }), { status: 200, headers: { "content-type": "application/json" } });
        },
      });
      const found = await provider.findProofCode(attempt.targetType, attempt.targetExternalId, attempt.proofCode);
      assert.equal(found, true);
      assert.deepEqual(urls, [`https://provider.example.test/${targetType === "vrchat_group" ? "groups" : "users"}/${f.args.targetExternalId}`]);
      const result = await f.t.mutation(internal.communityTelemetry.recordProofCheckResult, {
        collectorAccountId, workerKeyHash: "a".repeat(64), attemptId: attempt.attemptId, found, now: Date.now(),
      });
      assert.equal(result.state, "verified");
      const context = await f.client.query(api.profileClaims.getClaimJourneyContext, { profileSlug: f.args.profileSlug });
      assert.equal(context?.pendingProof, null);
      assert.equal(context?.lastVerifiedProof?.targetType, targetType);
      assert.equal(context?.ownership, "viewer");
      const links = await f.t.run(({ db }) => db.query("profileExternalLinks").collect());
      assert.equal(links.length, 1);
      assert.ok(links[0]?.verifiedByProofId);
      assert.equal(links[0]?.linkedByUserId, f.ids.userId);
    });
  }
}

it("normalizes target URLs before reservation lookup", async (c) => {
  const f = await fixture();
  c.mock.method(crypto, "randomUUID", () => "00000007-0000-4000-8000-000000000000");
  f.args.targetExternalId = `https://vrchat.com/home/user/${target}`;
  const first = await f.start();
  await f.t.run(({ db }) => db.patch(first.attemptId, { state: "failed" }));
  f.args.targetExternalId = target;
  await assert.rejects(f.start(), /ADAPTER_UNAVAILABLE/);
});

it("maps the target limit to BASIC's approved copy without exposing other claimants", () => {
  const error = claimError("PROOF_ISSUANCE_LIMIT");
  assert.equal(claimErrorMessage(error), "Too many new codes. Try again later.");
  assert.equal(claimFailureOutcome(error), "unavailable");
  assert.deepEqual(error.data, { code: "PROOF_ISSUANCE_LIMIT" });
});

it("excludes the exact rolling-window boundary but still reserves its code", async (c) => {
  const f = await fixture();
  c.mock.method(Date, "now", () => f.now);
  await f.t.run(async ({ db }) => {
    for (let i = 0; i < 20; i++) await db.insert("profileVerificationAttempts", {
      ...f.ids, method: "vrchat_user_proof", targetType: "vrchat_user", targetExternalId: target,
      proofCode: `VRDEX${i.toString().padStart(5, "0")}`, state: "failed",
      createdAt: f.now - DAY, updatedAt: f.now - DAY, expiresAt: f.now,
    });
  });
  const values = [7, 20];
  c.mock.method(crypto, "randomUUID", () => `${(values.shift() ?? 20).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`);
  assert.equal((await f.start()).proofCode, "VRDEX00020");
});

it("cancelling or choosing another profile does not release a code", async (c) => {
  const f = await fixture();
  c.mock.method(crypto, "randomUUID", () => "00000007-0000-4000-8000-000000000000");
  await f.start();
  await f.client.mutation(api.profileClaims.cancelClaimJourneyPending, {
    profileSlug: f.args.profileSlug, pendingType: "proof",
  });
  await f.t.run(async ({ db }) => {
    const profile = await db.get(f.ids.profileId);
    assert.ok(profile);
    const { _id, _creationTime, ...fields } = profile;
    await db.insert("profiles", { ...fields, slug: "short-code-second" });
  });
  f.args.profileSlug = "short-code-second";
  await assert.rejects(f.start(), /ADAPTER_UNAVAILABLE/);
});
