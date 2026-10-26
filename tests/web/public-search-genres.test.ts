import assert from "node:assert/strict";
import { test } from "node:test";

import {
  orderedPublicSearchGenres,
  publicSearchGenreLabel,
} from "../../apps/web/src/lib/public-search-genres";
import type { PublicSearchGenre } from "../../apps/web/src/lib/public-search";

test("genre labels prefer custom names and preserve featured order", () => {
  const genres: PublicSearchGenre[] = [
    { slug: "house", displayName: " House ", displayLabel: " " },
    { slug: "techno", displayName: "Techno", displayLabel: " Hard techno ", featured: true },
    { slug: "empty", displayName: " ", displayLabel: "\t", featured: true },
    { slug: "garage", displayName: "Garage", featured: true },
    { slug: "ambient", displayName: " Ambient " },
    { slug: "custom-only", displayName: "", displayLabel: " Leftfield " },
    { slug: "blank", displayName: "" },
  ];

  assert.deepEqual(orderedPublicSearchGenres(genres).map(publicSearchGenreLabel), [
    "Hard techno", "Garage", "House", "Ambient", "Leftfield",
  ]);
  assert.equal(publicSearchGenreLabel({ slug: "blank", displayName: " " }), "");
  assert.deepEqual(orderedPublicSearchGenres([]), []);
});

test("genre ordering does not mutate public results", () => {
  const house = Object.freeze({ slug: "house", displayName: "House" });
  const techno = Object.freeze({ slug: "techno", displayName: "Techno", featured: true });
  const genres = Object.freeze([house, techno]);

  assert.deepEqual(orderedPublicSearchGenres(genres), [techno, house]);
  assert.deepEqual(genres, [house, techno]);
});
