import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePublicSearchSuggestions } from "../../apps/web/src/lib/public-search-suggestions";

const person = {
  entityType: "profile", profileType: "person", slug: "basicbit", title: "BASICBIT", routePath: "/basicbit",
  imageUrl: "/seed/avatar.svg", profileImageUrl: "/seed/avatar.svg", logoImageUrl: "/seed/logo.svg",
  trustLabel: "claimed_verified", subtitle: "Person profile",
  avatarAppearance: { borderEnabled: true, borderColor: "#ffffff", borderWidthPx: 3, borderSoftnessPx: 0, radiusPercent: 18 },
};

test("accepts canonical public identities and preserves preview image metadata", () => {
  const results = [person,
    { entityType: "profile", profileType: "community", slug: "afterglow", title: "Afterglow", routePath: "/afterglow" },
    { entityType: "event", slug: "harbor", title: "Harbor", routePath: "/afterglow/events/harbor" },
    { entityType: "world", slug: "neon-harbor", title: "Neon Harbor", routePath: "/neon-harbor" },
  ];
  assert.deepEqual(parsePublicSearchSuggestions({ results }), results);
});

test("unsafe or noncanonical routes cannot become navigation targets", () => {
  for (const routePath of ["//example.invalid", "https://example.invalid", "javascript:alert(1)", "/\\example.invalid", "/basicbit?next=evil", "/basicbit#link", "/other", "/basicbit/../other", "/%2fexample.invalid", "/basicbit\n"]) {
    assert.deepEqual(parsePublicSearchSuggestions({ results: [{ ...person, routePath }] }), [], routePath);
  }
  assert.deepEqual(parsePublicSearchSuggestions({ results: [{ entityType: "event", slug: "harbor", title: "Harbor", routePath: "/events/harbor" }] }), []);
  assert.deepEqual(parsePublicSearchSuggestions({ results: [{ ...person, slug: "basicbit\n", routePath: "/basicbit\n" }] }), []);
  assert.deepEqual(parsePublicSearchSuggestions({ results: [{ entityType: "event", slug: "harbor", title: "Harbor", routePath: "/afterglow/events/harbor\n" }] }), []);
});

test("malformed envelopes and rows produce no selectable suggestions", () => {
  for (const value of ["<!doctype html>", null, [], {}, { results: null }, { results: {} }, { results: [person, null] },
    { results: [{ ...person, entityType: "private" }] }, { results: [{ ...person, profileType: "dj" }] },
    { results: [{ ...person, profileType: undefined }] }, { results: [{ ...person, title: " " }] },
    { results: [{ ...person, subtitle: {} }] }, { results: [{ ...person, imageUrl: 1 }] },
    { results: [{ ...person, trustLabel: "trusted" }] }, { results: [{ ...person, avatarAppearance: {} }] },
    { results: [{ ...person, avatarAppearance: { ...person.avatarAppearance, borderWidthPx: Infinity } }] },
    { results: [{ entityType: "world", profileType: "person", slug: "harbor", title: "Harbor", routePath: "/harbor" }] },
  ]) assert.deepEqual(parsePublicSearchSuggestions(value), []);
});

test("projects only the public preview fields", () => {
  assert.deepEqual(parsePublicSearchSuggestions({ results: [{ ...person, privateNotes: "not a preview", score: 42 }] }), [person]);
  assert.deepEqual(parsePublicSearchSuggestions({ results: [] }), []);
});
