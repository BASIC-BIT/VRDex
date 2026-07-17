import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeLookupSuggestions } from "../../apps/web/src/app/_components/lookup-suggestion-merge";
import type {
  PrivateSeedLookupResult,
  PublicProfileLookupResult,
} from "../../apps/web/src/app/_components/profile-lookup-page";

function publicProfile(overrides: Partial<PublicProfileLookupResult> = {}): PublicProfileLookupResult {
  return {
    aliases: [],
    displayName: "BASICBIT",
    genres: [],
    outboundLinks: [{
      label: "Twitch",
      source: "owner_authored",
      type: "twitch",
      url: "https://www.twitch.tv/basic_bit",
    }],
    profilePath: "/p/basicbit",
    roleTags: [],
    slug: "basicbit",
    tags: [],
    trustLabel: "claimed_verified",
    ...overrides,
  };
}

function privateCandidate(overrides: Partial<PrivateSeedLookupResult> = {}): PrivateSeedLookupResult {
  return {
    displayName: "BASICBIT",
    fields: [{
      confidence: "medium",
      fieldKey: "outboundLinks",
      id: "candidate-links",
      reviewState: "unreviewed",
      sourceLabel: "NWinn",
      value: [{ url: "https://www.twitch.tv/basic_bit/" }],
      visibility: "private",
    }],
    id: "candidate-basicbit",
    publicationState: "draft_private",
    reviewState: "unreviewed",
    source: { name: "NWinn" },
    ...overrides,
  };
}

describe("lookup suggestion merging", () => {
  it("prefers a public profile when a same-name private candidate shares a link", () => {
    const result = mergeLookupSuggestions([publicProfile()], [privateCandidate()]);

    assert.deepEqual(result.map((profile) => profile.displayName), ["BASICBIT"]);
  });

  it("prefers a public profile when the candidate proposes its canonical slug", () => {
    const result = mergeLookupSuggestions(
      [publicProfile()],
      [privateCandidate({ displayName: "BASIC BIT", fields: [], proposedSlug: "BASICBIT" })],
    );

    assert.equal(result.length, 1);
  });

  it("keeps same-name candidates when their public links differ", () => {
    const result = mergeLookupSuggestions(
      [publicProfile()],
      [privateCandidate({ fields: [{
        confidence: "medium",
        fieldKey: "outboundLinks",
        id: "other-links",
        reviewState: "unreviewed",
        sourceLabel: "NWinn",
        value: [{ url: "https://www.twitch.tv/a-different-dj" }],
        visibility: "private",
      }] })],
    );

    assert.equal(result.length, 2);
  });
});
