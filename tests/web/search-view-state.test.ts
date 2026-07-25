import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSearchFilter,
  parseSearchView,
  searchHref,
} from "../../apps/web/src/app/_components/search-view-state.ts";

test("search view state accepts only built-in presets and filters", () => {
  assert.equal(parseSearchView("dj"), "dj");
  assert.equal(parseSearchView("anything"), "standard");
  assert.equal(parseSearchFilter("person"), "person");
  assert.equal(parseSearchFilter("script:alert(1)"), "all");
  assert.equal(parseSearchFilter(undefined, "dj"), "person");
  assert.equal(parseSearchFilter("world", "dj"), "person");
});

test("search URLs are stable, shareable, and omit default state", () => {
  assert.equal(searchHref({ query: "BASICBIT" }), "/search?q=BASICBIT");
  assert.equal(
    searchHref({ query: "BASICBIT", view: "dj" }),
    "/search?q=BASICBIT&view=dj",
  );
  assert.equal(
    searchHref({ filter: "world", query: "Neon Harbor" }),
    "/search?q=Neon+Harbor&type=world",
  );
});
