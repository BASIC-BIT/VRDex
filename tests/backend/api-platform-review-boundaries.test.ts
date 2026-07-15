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

    assert.match(events, /const updateFields = suppliedEventDraftFields\(args\)/);
    assert.match(events, /preserveOmittedEventDocumentFields\(event, args\)/);
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
});
