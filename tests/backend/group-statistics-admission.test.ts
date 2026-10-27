import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import type { Doc } from "../../convex/_generated/dataModel";
const schema = (schemaModule as unknown as {default?: typeof schemaModule}).default ?? schemaModule;
const modules = { "../../convex/_generated/api.ts": () => import("../../convex/_generated/api") };
async function fixture() {
 const t = convexTest({schema, modules});
 const row = await t.run(async ctx => {
  const accountId = await ctx.db.insert("collectorAccounts", {vrchatUserId:"usr_test",accountAlias:"test",state:"ready",capacity:100,reservedHeadroom:10,assignedGroupCount:0,requestsPerMinute:10,secretRef:"test",workerKeyHash:"test",credentialGeneration:1,killSwitchEnabled:false,createdAt:1,updatedAt:1});
  const id = await ctx.db.insert("communityVrchatIntegrations", {collectionScope:{kind:"automatic"},vrchatGroupId:"grp_test",groupVisibility:"public",joinPolicy:"request",state:"connecting",assignedCollectorAccountId:accountId,killSwitchEnabled:false,requestsPerMinute:4,leaseGeneration:1,publicMetrics:{currentPopulation:true,populationHistory:false,groupMemberCount:true,groupMemberGrowth:false,eventRecaps:false},namedMembershipCollectionEnabled:false,publicationPolicy:"automatic_aggregate",enabledFeatures:["analytics"],telemetryEpochStartedAt:100,consecutiveFailures:0,createdAt:1,updatedAt:1});
  return (await ctx.db.get(id))!;
 });
 return {t,row};
}
it("legacy integrations do not acquire explicit authority", async () => {
 assert.ok("statisticsAdmission" in schema.tables.communityVrchatIntegrations.validator.fields);
 const {row} = await fixture();
 assert.equal(row.statisticsAdmission, undefined);
 const {admissionMatches} = await import("../../convex/_groupAdmission");
 assert.equal(admissionMatches(row, 200, row.assignedCollectorAccountId!), false);
});
it("usable grants match the attempt, epoch and assigned account and exclude revoked or paused phases", async () => {
 const {row,t} = await fixture();
 const {admissionMatches} = await import("../../convex/_groupAdmission");
 const grant = {authorizedAt:200,actor:{tokenIdentifier:"test|admin",issuer:"test",subject:"admin"},reason:"Public aggregate statistics",collectorAccountId:row.assignedCollectorAccountId!,joinPolicy:"request" as const,epochStartedAt:100,phase:"pending" as const,membershipOrigin:"unknown" as const};
 await t.run(ctx => ctx.db.patch(row._id,{statisticsAdmission:grant}));
 const integration = {...row,statisticsAdmission:grant};
 assert.equal(admissionMatches(integration,200,grant.collectorAccountId),true);
 assert.equal(admissionMatches({...integration,statisticsAdmission:{...grant,phase:"active"}},200,grant.collectorAccountId),true);
 for (const phase of ["paused","ended","cleanup_pending","cancelled"] as const) assert.equal(admissionMatches({...integration,statisticsAdmission:{...grant,phase,revokedAt:phase === "cleanup_pending" || phase === "cancelled" ? 300 : undefined}},200,grant.collectorAccountId),false);
 assert.equal(admissionMatches(integration,201,grant.collectorAccountId),false);
 assert.equal(admissionMatches({...integration,telemetryEpochStartedAt:101},200,grant.collectorAccountId),false);
 assert.equal(admissionMatches({...integration,assignedCollectorAccountId:undefined},200,grant.collectorAccountId),false);
 assert.equal(admissionMatches({...integration,statisticsAdmission:{...grant,revokedAt:300}},200,grant.collectorAccountId),false);
});
it("the helper rejects contradictory policy and phase combinations", async () => {
 const {row} = await fixture();
 const {assertStatisticsAdmission} = await import("../../convex/_groupAdmission");
 const grant = {authorizedAt:200,actor:{tokenIdentifier:"test|admin",issuer:"test",subject:"admin"},reason:"Reason",collectorAccountId:row.assignedCollectorAccountId!,joinPolicy:"request" as const,epochStartedAt:100,phase:"pending" as const,membershipOrigin:"admission" as const};
 assert.doesNotThrow(() => assertStatisticsAdmission(grant));
 assert.throws(() => assertStatisticsAdmission({...grant,joinPolicy:"free"}), /admission/i);
 assert.throws(() => assertStatisticsAdmission({...grant,operation:{kind:"accept_invite",startedAt:200,outcome:"uncertain"}}), /admission/i);
 assert.throws(() => assertStatisticsAdmission({...grant,phase:"cleanup_pending"}), /admission/i);
 assert.throws(() => assertStatisticsAdmission({...grant,reason:"   "}), /reason/i);
 assert.throws(() => assertStatisticsAdmission({...grant,reason:"x".repeat(501)}), /reason/i);
});
