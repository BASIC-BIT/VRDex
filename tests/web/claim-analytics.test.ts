import assert from "node:assert/strict";
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
});
