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
      reservedJourneyId: second,
    }), second);
    assert.equal(claimJourneyForAction({
      currentJourneyId: second,
      pendingJourneyId: first,
      previousJourneyFinished: false,
      currentJourneySubmitted: false,
      reservedJourneyId: "f822ec99-127f-458f-bff6-1f68f97a39ef",
    }), first);
  });

  it("offers a reserved journey in links after the active journey finishes", () => {
    const finished = "4d36e96e-34d9-4f7e-9fe1-72a98aa13077";
    const reserved = "3d3ed4dc-49b8-4bf1-8b4c-4606090e0c28";

    assert.equal(claimJourneyForAction({
      currentJourneyId: finished,
      pendingJourneyId: finished,
      previousJourneyFinished: true,
      currentJourneySubmitted: true,
      reservedJourneyId: reserved,
    }), reserved);
  });

  it("rotates a restored Discord journey before another method starts", () => {
    const discord = "4d36e96e-34d9-4f7e-9fe1-72a98aa13077";
    const vrchat = "3d3ed4dc-49b8-4bf1-8b4c-4606090e0c28";
    const pending = "f822ec99-127f-458f-bff6-1f68f97a39ef";

    assert.equal(claimJourneyForAction({
      currentJourneyId: discord,
      previousJourneyFinished: false,
      currentJourneySubmitted: false,
      reservedJourneyId: vrchat,
      forceRotate: true,
    }), vrchat);
    assert.equal(claimJourneyForAction({
      currentJourneyId: discord,
      pendingJourneyId: pending,
      previousJourneyFinished: false,
      currentJourneySubmitted: false,
      reservedJourneyId: vrchat,
      forceRotate: true,
    }), pending);
  });

  it("uses one in-memory journey without storage or adoption mutations", async () => {
    const source = await readFile("apps/web/src/app/claim/[slug]/claim-flow.tsx", "utf8");
    assert.match(source, /useState\(initialAnalyticsJourneyId\)/);
    assert.match(source, /reservedJourneyId: reservedAnalyticsJourneyId/);
    assert.match(source, /journeyId = started\.analyticsJourneyId/);
    assert.match(source, /context\?\.pendingProof\?\.analyticsJourneyId/);
    assert.match(
      source,
      /checkProof\(started\.attemptId, "vrclinking", started\.analyticsJourneyId\)/,
    );
    assert.doesNotMatch(source, /sessionStorage|adoptPending.*Analytics/);
    assert.match(source, /const \{ isLoaded, sessionId \} = useAuth\(\)/);
    assert.match(
      source,
      /scopedJourneys === null[\s\S]*current: props\.initialAnalyticsJourneyId/,
    );
    assert.match(source, /key=\{analyticsSessionScope\}/);
    assert.match(
      source,
      /setCollectorCompletion\(\{[\s\S]*setAnalyticsJourneyFinished\(true\)/,
    );
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
    assert.match(flow, /discordVerificationHref\(nextActionAnalyticsJourneyId\)/);
    assert.match(flow, /onClick=\{prepareDiscordVerification\}/);
    assert.doesNotMatch(flow, /onContextMenu=\{prepareDiscordVerification\}/);
    assert.doesNotMatch(flow, /onMouseDown=\{prepareDiscordVerification\}/);
    assert.match(callback, /withStatus\(returnTo, "verified", verifiedGuildCount, analyticsJourneyId\)/);
  });

  it("latches a reloaded pending proof before any check handler runs", async () => {
    const source = await readFile("apps/web/src/app/claim/[slug]/claim-flow.tsx", "utf8");
    assert.match(
      source,
      /validClaimJourneyId\(pendingAnalyticsJourneyId\)[\s\S]{0,400}setSubmittedAnalyticsJourneyId\(pendingAnalyticsJourneyId\)/,
    );
  });

  it("marks Discord callback journeys so another method rotates them", async () => {
    const flow = await readFile("apps/web/src/app/claim/[slug]/claim-flow.tsx", "utf8");
    const page = await readFile("apps/web/src/app/claim/[slug]/page.tsx", "utf8");

    assert.match(flow, /discordJourneyRestored[\s\S]*discordReturnJourneyActive/);
    assert.match(flow, /forceRotate:\s*discordReturnJourneyActive && nextMethod !== "discord"/);
    assert.match(page, /discordOAuthReturn[\s\S]*discordJourneyRestored=/);
  });
});
