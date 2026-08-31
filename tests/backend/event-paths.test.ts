import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { eventPathForSlugs } from "../../convex/_eventPaths";

describe("event paths", () => {
  it("keeps community events out of the root entity namespace", () => {
    assert.equal(
      eventPathForSlugs("afterglow", "harbor-sessions"),
      "/afterglow/events/harbor-sessions",
    );
  });

  it("uses the event namespace when a community is unavailable", () => {
    assert.equal(
      eventPathForSlugs(undefined, "harbor-sessions"),
      "/events/harbor-sessions",
    );
  });
});
