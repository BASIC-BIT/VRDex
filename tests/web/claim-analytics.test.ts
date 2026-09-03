import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  claimJourneyForAction,
  validClaimJourneyId,
} from "../../apps/web/src/lib/claim-analytics";

describe("claim analytics journey correlation", () => {
  it("accepts only opaque UUID journey identifiers", () => {
    assert.equal(validClaimJourneyId("4d36e96e-34d9-4f7e-9fe1-72a98aa13077"), true);
    assert.equal(validClaimJourneyId("profile-basicbit"), false);
    assert.equal(validClaimJourneyId(undefined), false);
  });

  it("rotates after a submitted attempt disappears in the background", () => {
    const first = "4d36e96e-34d9-4f7e-9fe1-72a98aa13077";
    const second = "3d3ed4dc-49b8-4bf1-8b4c-4606090e0c28";
    assert.equal(claimJourneyForAction({
      currentJourneyId: first,
      previousJourneyFinished: false,
      currentJourneySubmitted: true,
      generate: () => second,
    }), second);
    assert.equal(claimJourneyForAction({
      currentJourneyId: second,
      pendingJourneyId: first,
      previousJourneyFinished: false,
      currentJourneySubmitted: false,
      generate: () => { throw new Error("pending journey should win"); },
    }), first);
  });

  it("uses one in-memory journey without storage or adoption mutations", async () => {
    const source = await readFile("apps/web/src/app/claim/[slug]/claim-flow.tsx", "utf8");
    assert.match(source, /useState\(initialAnalyticsJourneyId\)/);
    assert.match(source, /generate: \(\) => crypto\.randomUUID\(\)/);
    assert.match(source, /journeyId = started\.analyticsJourneyId/);
    assert.match(source, /context\?\.pendingProof\?\.analyticsJourneyId/);
    assert.match(
      source,
      /checkProof\(started\.attemptId, "vrclinking", started\.analyticsJourneyId\)/,
    );
    assert.doesNotMatch(source, /sessionStorage|adoptPending.*Analytics|useAuth/);
    assert.match(source, /claim_journey_viewed/);
    assert.match(source, /claim_method_selected/);
    assert.match(source, /claim_submitted/);
    assert.match(source, /claim_completed/);
    assert.match(source, /claim_failed/);
  });

  it("carries the journey through Discord OAuth with one click handler", async () => {
    const flow = await readFile("apps/web/src/app/claim/[slug]/claim-flow.tsx", "utf8");
    const callback = await readFile("apps/web/src/app/api/discord/verify/callback/route.ts", "utf8");
    assert.match(flow, /analyticsJourneyId/);
    assert.match(flow, /analyticsEntrySource/);
    assert.match(flow, /analyticsProfileType/);
    assert.match(flow, /onClick=\{prepareDiscordVerification\}/);
    assert.doesNotMatch(flow, /onContextMenu=\{prepareDiscordVerification\}/);
    assert.doesNotMatch(flow, /onMouseDown=\{prepareDiscordVerification\}/);
    assert.match(callback, /withStatus\(returnTo, "verified", verifiedGuildCount, analyticsJourneyId\)/);
  });
});
