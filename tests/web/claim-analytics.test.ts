import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  claimJourneyStorageKey,
  resolveClaimJourneyId,
  validClaimJourneyId,
} from "../../apps/web/src/lib/claim-analytics";

const first = "4d36e96e-34d9-4f7e-9fe1-72a98aa13077";
const second = "3d3ed4dc-49b8-4bf1-8b4c-4606090e0c28";

describe("claim analytics journey correlation", () => {
  it("resumes the backend journey ahead of browser storage", () => {
    assert.equal(
      resolveClaimJourneyId({
        pendingJourneyId: first,
        storedJourneyId: second,
        generate: () => { throw new Error("should not generate"); },
      }),
      first,
    );
  });

  it("keeps a stored journey stable across a browser remount", () => {
    assert.equal(
      resolveClaimJourneyId({
        storedJourneyId: second,
        generate: () => { throw new Error("should not generate"); },
      }),
      second,
    );
  });

  it("rejects identifiers that could carry an encoded profile identity", () => {
    assert.equal(validClaimJourneyId("profile-basicbit"), false);
    assert.throws(
      () => resolveClaimJourneyId({ generate: () => "profile-basicbit" }),
      /opaque UUID/,
    );
  });

  it("scopes browser resume storage to one authenticated session and profile", () => {
    assert.equal(
      claimJourneyStorageKey("basicbit", "sess_first"),
      "vrdex:claim-journey:sess_first:basicbit",
    );
    assert.notEqual(
      claimJourneyStorageKey("basicbit", "sess_first"),
      claimJourneyStorageKey("basicbit", "sess_second"),
    );
  });

  it("latches terminal component journeys and excludes verified-owner connection visits", async () => {
    const source = await readFile(
      "apps/web/src/app/claim/[slug]/claim-flow.tsx",
      "utf8",
    );
    assert.match(source, /analyticsJourneyFinishedRef\.current = true/);
    assert.match(source, /initialAnalyticsJourneyConsumedRef = useRef\(false\)/);
    assert.match(
      source,
      /if \(!initialAnalyticsJourneyConsumedRef\.current\)[\s\S]*return initialAnalyticsJourneyId[\s\S]*return crypto\.randomUUID\(\)/,
    );
    assert.match(source, /analyticsJourneyFinishedRef\.current\s*\) return/);
    assert.match(source, /lastObservedPendingJourneyRef/);
    assert.match(source, /lastObservedPendingWorkRef/);
    assert.match(source, /preserveInitialDiscordReturnRef = useRef\(discordVerify != null\)/);
    assert.match(source, /preserveInitialDiscordReturnRef\.current = false/);
    assert.match(source, /const \{ isLoaded, sessionId \} = useAuth\(\)/);
    assert.match(source, /key=\{analyticsSessionScope\}/);
    assert.match(source, /scopedInitialJourney\?\.sessionScope !== analyticsSessionScope/);
    assert.match(source, /scopedInitialJourney === null[\s\S]*crypto\.randomUUID\(\)/);
    assert.match(
      source,
      /initialAnalyticsJourneyId=\{scopedInitialJourney\.journeyId\}/,
    );
    assert.match(source, /claimJourneyStorageKey\(profile\.slug, analyticsSessionScope\)/);
    assert.match(source, /previous\.viewerContextKey === viewerContextKey/);
    assert.match(
      source,
      /collectorCompletion\?\.sessionScope === analyticsSessionScope \? collectorCompletion : null/,
    );
    assert.match(source, /analyticsJourneyId/);
    assert.match(source, /analyticsProfileType/);
    assert.match(source, /prepareDiscordVerification/);
    assert.match(
      source,
      /context\?\.pendingProof != null \|\| context\?\.pendingClaimRequest != null/,
    );
    assert.match(
      source,
      /previous === undefined && current === null && !hasPendingClaimWork[\s\S]*staleStoredJourney/,
    );
    assert.match(
      source,
      /previous !== null[\s\S]*staleStoredJourney[\s\S]*current === null[\s\S]*activeCollectorCompletion === null[\s\S]*finishAnalyticsJourney\(\)/,
    );
    assert.match(
      source,
      /previouslyHadPendingClaimWork === true && !hasPendingClaimWork/,
    );
    assert.match(
      source,
      /discordReturnJourneyActiveRef\.current && nextMethod !== "discord"[\s\S]*initialAnalyticsJourneyConsumedRef\.current = true[\s\S]*finishAnalyticsJourney\(\)/,
    );
    assert.match(source, /beginAnalyticsJourneyForMethod\(nextMethod\)/);
    assert.match(source, /beginAnalyticsJourneyForMethod\(method\)/);
    assert.match(source, /!result\.canceled[\s\S]*finishAnalyticsJourney\(\)/);
    assert.match(
      source,
      /const adopted = await adoptPendingProofAnalytics\(\{[\s\S]*journeyId = adoptAnalyticsJourneyId\(adopted\.analyticsJourneyId\)[\s\S]*captureMethodSelection\(journeyId, proofMethod\)/,
    );
    assert.match(
      source,
      /async function checkDiscord[\s\S]*const adopted = await adoptPendingClaimRequestAnalytics\(\{[\s\S]*journeyId = adoptAnalyticsJourneyId\(adopted\.analyticsJourneyId\)[\s\S]*await verifyDiscord/,
    );
    assert.match(
      source,
      /async function startOver[\s\S]*adoptPendingClaimRequestAnalytics[\s\S]*adoptPendingProofAnalytics[\s\S]*cancelPending/,
    );
    assert.match(
      source,
      /activeCollectorCompletion\.journeyId \?\? ensureAnalyticsJourneyId\(\)/,
    );
    assert.match(source, /if \(isVerifiedViewer\) return;/);
    assert.match(source, /selectedMethodKeysRef[\s\S]*claim_method_selected/);
    assert.match(
      source,
      /const discordAnalyticsHref =[\s\S]*analyticsJourneyId[\s\S]*analyticsEntrySource[\s\S]*analyticsProfileType/,
    );
    assert.match(source, /href=\{discordAnalyticsHref\}/);
    assert.match(source, /onContextMenu=\{prepareDiscordVerification\}/);
    assert.match(source, /onMouseDown=\{prepareDiscordVerification\}/);
    assert.match(
      source,
      /async function submit[\s\S]*captureMethodSelection\(journeyId, method\)[\s\S]*claim_submitted/,
    );
    assert.match(source, /if \(!isVerifiedViewer\) \{[\s\S]*claim_submitted/);
  });

  it("renders an opaque initial journey into Discord link targets", async () => {
    const page = await readFile("apps/web/src/app/claim/[slug]/page.tsx", "utf8");
    const callback = await readFile(
      "apps/web/src/app/api/discord/verify/callback/route.ts",
      "utf8",
    );
    assert.match(
      page,
      /validClaimJourneyId\(rawAnalyticsJourneyId\)[\s\S]*rawAnalyticsJourneyId[\s\S]*crypto\.randomUUID\(\)/,
    );
    assert.match(
      callback,
      /withStatus\(returnTo, "verified", verifiedGuildCount, analyticsJourneyId\)/,
    );
    assert.match(callback, /withAnalyticsJourney\([\s\S]*pending\.analyticsJourneyId/);
  });
});
