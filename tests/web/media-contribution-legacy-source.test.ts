import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import { modules, schema, seed, createAndUpload } from "../backend/_mediaReviewFixture";
import { publishedContributionDetailSchema } from "../../packages/api-contracts/src/media-review";
import { createMcpMediaReviewHandlers } from "../../apps/web/src/lib/server/mcp-media-review";

process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";

async function fixture() {
  const t = convexTest({ schema, modules }); const s = await seed(t);
  const { intent } = await createAndUpload(t, s);
  const reviewer = t.withIdentity(s.moderatorIdentity);
  const pending = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: intent.submissionId });
  assert.ok(pending);
  assert.equal((await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, {
    submissionId: intent.submissionId, expectedReviewVersion: pending.reviewVersion,
    decision: "approve", privateReason: "Reviewed", idempotencyKey: "publish",
  })).operationState, "committed");
  const actor = t.withIdentity(s.contributorIdentity);
  const detail = () => actor.query(api.profileMediaSubmissions.contributionDetail, { submissionId: intent.submissionId });
  return { t, s, intent, actor, detail };
}

it("preserves an own published historical long source through authenticated MCP get while refusing new oversize writes", async () => {
  const f = await fixture(); const d = await f.detail();
  const sourceUrl = "https://legacy.example/source?signature=" + "a".repeat(5000);
  await f.t.run(ctx => ctx.db.patch(d.assetId, { sourceUrl }));
  const handlers = createMcpMediaReviewHandlers({
    actorUserId: f.s.contributorUserId, now: () => Date.now(), verifyContributorEmail: async () => true,
    query: async (name, args) => {
      assert.equal(name, "contributionGet"); assert.equal(args.actorUserId, f.s.contributorUserId);
      assert.equal(args.submissionId, f.intent.submissionId);
      return await f.t.query(internal.profileMediaSubmissions.contributionDetailForMcpActor, {
        submissionId: f.intent.submissionId, actorUserId: f.s.contributorUserId,
        emailVerified: args.emailVerified === true,
        emailVerificationAttestedAt: typeof args.emailVerificationAttestedAt === "number" ? args.emailVerificationAttestedAt : 0,
      });
    },
    mutate: async () => { throw new Error("Oversize command must be refused before backend mutation."); },
    readStoredObject: async () => null,
  });
  const result = await handlers.contributionGet({ submissionId: f.intent.submissionId });
  assert.equal(result.isError, undefined);
  assert.equal(publishedContributionDetailSchema.parse(result.structuredContent).metadata.sourceUrl, sourceUrl);
  const before = await f.t.run(async ctx => ({ asset: await ctx.db.get(d.assetId),
    reservations: await ctx.db.query("contributionUploadReservations").collect() }));
  const current = await f.detail();
  await assert.rejects(handlers.contributionManage({ submissionId: f.intent.submissionId,
    expectedContributionVersion: current.contributionVersion, idempotencyKey: "legacy-oversize",
    action: "update_metadata", metadata: { sourceUrl } }), /4096/);
  assert.deepEqual(await f.t.run(async ctx => ({ asset: await ctx.db.get(d.assetId),
    reservations: await ctx.db.query("contributionUploadReservations").collect() })), before);
});
