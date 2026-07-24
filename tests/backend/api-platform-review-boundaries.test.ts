import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("API platform review boundaries", () => {
  it("limits developer credentials only after applying owner and status indexes", () => {
    const schema = source("convex/schema.ts");
    const apiTokens = source("convex/apiTokens.ts");
    const oauthApps = source("convex/oauthApps.ts");

    assert.match(schema, /by_ownerKind_ownerUserId_createdAt/);
    assert.match(schema, /by_ownerKind_ownerUserId_status_createdAt/);
    assert.match(apiTokens, /withIndex\("by_ownerKind_ownerUserId_createdAt"/);
    assert.match(apiTokens, /withIndex\("by_ownerKind_ownerUserId_status_createdAt"/);
    assert.doesNotMatch(apiTokens, /take\(limit \* 2\)/);

    assert.match(schema, /by_ownerCommunityProfileId_createdAt/);
    assert.match(oauthApps, /withIndex\("by_ownerCommunityProfileId_createdAt"/);
  });

  it("attributes every client-credentials outcome to the OAuth token route class", () => {
    const oauthApps = source("convex/oauthApps.ts");
    const handler = oauthApps.slice(
      oauthApps.indexOf("async function issueClientCredentialsAccessTokenRecord"),
      oauthApps.indexOf("export const issueClientCredentialsAccessToken"),
    );

    assert.equal(handler.match(/routeClass: "oauth_token"/g)?.length, 4);
  });

  it("preserves omitted event PATCH fields and relation rows", () => {
    const events = source("convex/events.ts");

    assert.match(events, /const eventDraftUpdateArgs = \{[\s\S]*title: v\.optional\(v\.string\(\)\)[\s\S]*startAt: v\.optional\(v\.number\(\)\)/);
    assert.match(events, /const updateFields = suppliedEventDraftFields\(args\)/);
    assert.match(events, /preserveOmittedEventDraftFields\(args, \{/);
    assert.match(events, /communitySlug: currentCommunity\.slug/);
    assert.match(events, /shouldUpdate\("watchSurfaceEnabled"\)/);
    assert.match(events, /shouldUpdate\("mediaLinks"\)/);
    assert.match(events, /const replaceWorld = shouldUpdate\("worldSlug"\)/);
    assert.match(events, /const replaceSlots = shouldUpdate\("slotLinks"\)/);
    assert.match(events, /const replaceParticipants = shouldUpdate\("participantLinks"\)/);
    assert.match(events, /syncPreservedEventAssociationStartAt/);
  });

  it("creates and returns refresh tokens only for clients that allow refresh", () => {
    const oauthApps = source("convex/oauthApps.ts");
    const oauthToken = source("apps/web/src/lib/server/oauth-token.ts");

    assert.match(oauthApps, /const refreshTokenIssued =/);
    assert.match(oauthApps, /if \(refreshTokenIssued\) \{\s+await ctx\.db\.insert\("oauthRefreshTokens"/);
    assert.match(oauthToken, /result\.refreshTokenIssued \? \{ refresh_token: refreshToken \} : \{\}/);
  });

  it("applies community event list limits in the backend query", () => {
    const route = source("apps/web/src/app/api/v0/communities/[slug]/events/route.ts");

    assert.match(route, /api\.events\.listHostedByCommunitySlug/);
    assert.match(route, /communitySlug: slug/);
    assert.match(route, /limit,/);
    assert.doesNotMatch(route, /profile\.hostedEvents\.slice/);
  });

  it("keeps owned OAuth apps out of the client metadata URL namespace", () => {
    const oauthApps = source("convex/oauthApps.ts");
    const createOwnedApplication = oauthApps.slice(
      oauthApps.indexOf("async function createOwnedApplication"),
      oauthApps.indexOf("export const createPersonalApplication"),
    );

    assert.match(createOwnedApplication, /normalizeOwnedOAuthClientId\(args\.clientId\)/);
    assert.doesNotMatch(createOwnedApplication, /normalizeOAuthClientId\(args\.clientId\)/);
  });

  it("inspects failed-auth limits before durable bearer validation", () => {
    const apiV0 = source("apps/web/src/lib/server/api-v0.ts");
    const evaluation = apiV0.slice(apiV0.indexOf("export async function authenticateOptionalApiBearerRequest"));
    const mcp = source("apps/web/src/lib/server/vrdex-mcp.ts");
    const mcpEvaluation = mcp.slice(mcp.indexOf("export async function rejectInvalidOrRateLimitedMcpRequest"));

    assert.ok(
      evaluation.indexOf("increment: false")
        < evaluation.indexOf("authenticateOptionalApiBearerToken(request, options)"),
    );
    const temporalContinuation = source("apps/web/src/app/api/v0/time/parse/[continuationToken]/route.ts");
    const temporalSubmission = source("apps/web/src/app/api/v0/time/parse/route.ts");
    assert.match(temporalSubmission, /authorizeTemporalApiRequest\(request\)/);
    assert.match(
      temporalContinuation,
      /authorizeTemporalApiRequest\(request, \{\s*routeClass: "authenticated_public_read",/,
    );
    assert.ok(
      mcpEvaluation.indexOf("increment: false")
        < mcpEvaluation.indexOf("authenticateMcpBearerToken(request, bearerToken)"),
    );
  });

  it("keeps temporal submissions internal and ships ICU-compatible timezone data", () => {
    const temporalParsing = source("convex/temporalParsing.ts");
    const workerDockerfile = source("workers/temporal-inference/Dockerfile");

    assert.doesNotMatch(temporalParsing, /export const submitForCurrentUser = mutation/);
    assert.doesNotMatch(temporalParsing, /export const getJobForCurrentUser = query/);
    assert.match(workerDockerfile, /\btzdata\b/);
    assert.match(workerDockerfile, /\btzdata-legacy\b/);
  });

  it("keeps temporal retention controls available when beta parsing is disabled", () => {
    const temporalPage = source("apps/web/src/app/time/temporal-parser.tsx");
    const disabledSurface = temporalPage.slice(
      temporalPage.indexOf("if (!enabled)"),
      temporalPage.indexOf("return (", temporalPage.indexOf("if (!enabled)")) + 1_000,
    );
    const retentionSurface = temporalPage.slice(
      temporalPage.indexOf("export function TemporalRetentionUnavailableSurface"),
      temporalPage.indexOf("async function readTemporalResponse"),
    );

    assert.match(disabledSurface, /TemporalRetentionUnavailableSurface/);
    assert.match(disabledSurface, /changeRetention/);
    assert.match(retentionSurface, /TemporalRetentionControl/);
  });
});
