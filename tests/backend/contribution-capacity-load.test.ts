import assert from "node:assert/strict";
import { it } from "node:test";
import { performance } from "node:perf_hooks";
import { convexTest } from "convex-test";
import { internal } from "../../convex/_generated/api";
import { schema, modules as base, seed, NOW } from "./_mediaReviewFixture";
const modules = {
  ...base,
  "../../convex/contributionUploads.ts": () =>
    import("../../convex/contributionUploads"),
  "../../convex/contributionCapacity.ts": () =>
    import("../../convex/contributionCapacity"),
  "../../convex/contributionOperations.ts": () =>
    import("../../convex/contributionOperations"),
};
it("measures 1000 open proposals plus another actor using transactional admission and completion", async (context) => {
  const env = { ...process.env };
  let clock = Date.now();
  context.mock.method(Date, "now", () => clock);
  Object.assign(process.env, {
    CONVEX_DEPLOYMENT: "local:contributor-capacity-proof",
    VRDEX_CONTRIBUTION_POLICY: "synthetic-v1",
    VRDEX_CONTRIBUTION_UPLOADS_ENABLED: "true",
    VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED: "true",
    VRDEX_MEDIA_UPLOAD_CLEANUP_READY: "true",
    VRDEX_MEDIA_CLEANUP_URL: "https://example.test/api/internal/media-cleanup",
    VRDEX_MEDIA_CLEANUP_TOKEN: "test",
  });
  try {
    const t = convexTest({
        schema,
        modules,
        transactionLimits: { bytesRead: 2_000_000 },
      }),
      s = await seed(t);
    const actors = [s.contributorUserId, s.moderatorUserId];
    const profiles = await t.run(async (ctx) => {
      const original = (await ctx.db.get(s.profileId))!;
      const { _id, _creationTime, ...template } = original;
      const profiles = [];
      for (let i = 0; i < 112; i++)
        profiles.push(
          await ctx.db.insert("profiles", { ...template, slug: `load-${i}` }),
        );
      for (let i = 0; i < 2; i++) {
        await ctx.db.insert("accountFeatureGrants", {
          userId: actors[i],
          feature: "trusted_contributor",
          state: "active",
          grantedBy: {
            issuer: "test",
            subject: "operator",
            tokenIdentifier: "test:operator",
          },
          grantedAt: clock,
          updatedAt: clock,
        });
        await ctx.db.insert("oauthAccessTokens", {
          tokenId: `token${i}`,
          clientId: `client${i}`,
          subjectType: "user",
          userId: actors[i],
          resource: "https://example.test/mcp",
          scopes: ["mcp:read", "mcp:write", "assets:contribute"],
          status: "active",
          issuedAt: clock,
          expiresAt: clock + 86400000,
        });
      }
      return profiles;
    });
    const times: number[] = [];
    const start = performance.now();
    const authority = (actor: number) => ({
      actorUserId: actors[actor],
      oauthClientId: `client${actor}`,
      oauthTokenId: `token${actor}`,
      emailVerified: true,
      emailVerificationAttestedAt: clock,
    });
    const input = (i: number, actor: number) => ({
      ...authority(actor),
      mode: "contributor" as const,
      profileId: profiles[Math.floor(i / 10)],
      expectedUpdatedAt: NOW,
      placement: "profile_image" as const,
      contentType: "image/png",
      byteLength: 512,
      sha256: "a".repeat(64),
      credit: "Synthetic artist",
      sourceDescription: "Synthetic fixture",
      idempotencyKey: `load-${i}`,
    });
    for (let i = 0; i < 1100; i++) {
      const actor = i < 1000 ? 0 : 1;
      const before = performance.now();
      const admitted = await t.mutation(
        internal.contributionUploads.begin,
        input(i, actor),
      );
      assert.ok("intentId" in admitted, JSON.stringify(admitted));
      times.push(performance.now() - before);
      const claim = {
        ...authority(actor),
        intentId: admitted.intentId,
        idempotencyKey: `complete-${i}`,
        processingToken: `worker-${i}`,
      };
      await t.mutation(internal.contributionUploads.claim, claim);
      const result = await t.mutation(internal.contributionUploads.complete, {
        ...claim,
        mimeType: "image/webp",
        byteSize: 100,
        contentSha256: i.toString(16).padStart(64, "0"),
        width: 10,
        height: 10,
        sourceMimeType: "image/png",
        sourceByteSize: 512,
        sourceContentSha256: "a".repeat(64),
        downloadMimeType: "image/png",
        downloadByteSize: 200,
        downloadContentSha256: i.toString(16).padStart(64, "0"),
      });
      assert.equal(result.operationState, "committed");
      clock += 6000;
    }
    const refusal = await t.mutation(internal.contributionUploads.begin, {
      ...input(1100, 0),
      idempotencyKey: "over-ceiling",
    });
    assert.equal(refusal.receipt?.code, "CONTRIBUTION_ACTOR_OPEN_LIMIT");
    const capacity = await t.query(
      internal.contributionCapacity.get,
      authority(0),
    );
    assert.equal(capacity.usage.bytes, 1_324_000);
    assert.equal(capacity.usage.processing, 0);
    times.sort((a, b) => a - b);
    context.diagnostic(
      JSON.stringify({
        engine: "convex-test",
        proposals: 1100,
        actors: 2,
        actorOpenCeiling: 1000,
        transactionReadByteBudget: 2000000,
        elapsedMs: Math.round(performance.now() - start),
        admissionP50Ms: times[550],
        admissionP95Ms: times[1045],
        admissionMaxMs: times[1099],
        actorRetainedBytes: capacity.usage.bytes,
        realStorage: false,
      }),
    );
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});
