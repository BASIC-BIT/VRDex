import assert from "node:assert/strict";
import { request } from "@playwright/test";
import { cleanupClerkTestAccountData, deleteClerkTestAccountByEmail } from "./clerk-auth";
import { mediaFixtureRunId } from "./media-run-id";

// Explicit operator recovery only. This script never creates fixtures or deploys.
async function main() {
  const runId = mediaFixtureRunId({ VRDEX_E2E_MEDIA_RUN_ID: process.env.MEDIA_RECOVERY_RUN_ID });
  const expectedCommit = process.env.MEDIA_RECOVERY_EXPECTED_COMMIT;
  const expectedProfileId = process.env.MEDIA_RECOVERY_PROFILE_ID;
  const token = process.env.VRDEX_E2E_BROWSER_TOKEN;
  assert.match(expectedCommit ?? "", /^[a-f0-9]{40}$/);
  assert.ok(token && process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"));
  assert.ok(expectedProfileId);
  const client = await request.newContext({ baseURL: "https://staging.vrdex.net", timeout: 30_000 });
  try {
    const deployment = await client.get("/api/deployment");
    assert.equal(deployment.status(), 200);
    const identity = await deployment.json();
    assert.equal(identity.commit, expectedCommit);
    assert.equal(identity.convexServer, "https://scrupulous-corgi-247.convex.cloud");
    assert.equal(identity.clerkFrontendApi, "https://oriented-anemone-94.clerk.accounts.dev");
    const headers = { "x-vrdex-e2e-token": token };
    const lookup = async () => {
      const response = await client.post("/api/e2e/media", { headers, data: { op: "lookup", runId } });
      assert.equal(response.status(), 200, "Fixture lookup must succeed");
      return (await response.json()).profileId as string | null;
    };
    const profileId = await lookup();
    assert.ok(profileId === null || profileId === expectedProfileId, "Fixture identity must match the recovery packet");
    {
      // Even an absent profile must pass the server's no-dependent-media check.
      const response = await client.delete("/api/e2e/media", { headers, data: { runId, profileId: expectedProfileId } });
      assert.equal(response.status(), 200, "Media cleanup must succeed before identity deletion");
      const result = await response.json();
      assert.equal(result.deletedMedia, true);
      assert.equal(await lookup(), null, "Fixture must be absent after cleanup");
    }
    for (const role of ["contributor", "reviewer"]) {
      const email = `${runId}-${role}+clerk_test@e2e.vrdex.net`;
      const response = await cleanupClerkTestAccountData(client, token, { email });
      assert.equal(response?.status(), 200, "Convex cleanup must succeed before Clerk deletion");
      const absentUser = await cleanupClerkTestAccountData(client, token, { email });
      assert.equal(absentUser?.status(), 200);
      assert.deepEqual(await absentUser!.json(), { deleted: false });
      const result = await deleteClerkTestAccountByEmail(email);
      assert.equal(result.checked, true);
      assert.equal(result.failed, 0);
      const absence = await deleteClerkTestAccountByEmail(email);
      assert.deepEqual(absence, { deleted: 0, failed: 0, checked: true });
    }
    console.info(`Media recovery complete: ${runId}; operational fixture removed; historical audit retained.`);
  } finally {
    await client.dispose();
  }

}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Media recovery failed.");
  process.exitCode = 1;
});
