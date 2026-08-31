import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createEventSlugBase } from "../../convex/_eventSlugs";
import { eventPathForSlugs } from "../../convex/_eventPaths";

describe("event paths", () => {
  it("keeps community events out of the root entity namespace", () => {
    assert.equal(
      eventPathForSlugs("afterglow", "harbor-sessions"),
      "/afterglow/events/harbor-sessions",
    );
  });

  it("keeps the nested create route out of generated event slugs", () => {
    assert.equal(createEventSlugBase("Create"), "create-event");
  });
});
