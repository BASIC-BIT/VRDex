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

  it("scopes browser resume storage to one profile journey", () => {
    assert.equal(claimJourneyStorageKey("basicbit"), "vrdex:claim-journey:basicbit");
  });

  it("latches terminal component journeys and excludes verified-owner connection visits", async () => {
    const source = await readFile(
      "apps/web/src/app/claim/[slug]/claim-flow.tsx",
      "utf8",
    );
    assert.match(source, /analyticsJourneyFinishedRef\.current = true/);
    assert.match(source, /analyticsJourneyFinishedRef\.current\s*\) return/);
    assert.match(source, /lastObservedPendingJourneyRef/);
    assert.match(source, /previous === undefined && current === null[\s\S]*staleStoredJourney/);
    assert.match(
      source,
      /previous !== null[\s\S]*staleStoredJourney[\s\S]*current === null[\s\S]*collectorCompletion === null[\s\S]*finishAnalyticsJourney\(\)/,
    );
    assert.match(source, /!result\.canceled[\s\S]*finishAnalyticsJourney\(\)/);
    assert.match(
      source,
      /collectorCompletion\.journeyId \?\? ensureAnalyticsJourneyId\(\)/,
    );
    assert.match(source, /if \(isVerifiedViewer\) return;/);
    assert.match(source, /if \(!isVerifiedViewer\) \{[\s\S]*claim_method_selected/);
    assert.match(source, /if \(!isVerifiedViewer\) \{[\s\S]*claim_submitted/);
  });
});
