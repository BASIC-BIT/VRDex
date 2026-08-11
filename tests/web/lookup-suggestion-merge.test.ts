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
      url: "https://twitch.tv/BASIC_BIT",
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

  // A published candidate is expected to have a public row: it made one. Keeping
  // both listed the same person twice -- once with the profile's avatar, once as
  // the candidate's bare name -- for every one of the 405 published seeds, which
  // is the lookup "duplicating everybody" an operator reported.
  it("drops a published candidate when the profile it published to is on screen", () => {
    const bySlug = mergeLookupSuggestions(
      [publicProfile()],
      [privateCandidate({
        fields: [],
        publicationState: "published_unclaimed",
        publishedProfileSlug: "basicbit",
      })],
    );

    assert.equal(bySlug.length, 1);

    // And by the name-plus-link route, for a candidate published before the slug
    // was recorded.
    const byIdentity = mergeLookupSuggestions(
      [publicProfile()],
      [privateCandidate({ publicationState: "published_unclaimed" })],
    );

    assert.equal(byIdentity.length, 1);
  });

  // The other half of that rule, and the reason the exemption existed: dropping
  // published candidates outright is what hid 405 published people here.
  // Removing one is only safe while the profile it published to takes its place.
  it("keeps a published candidate whose profile is not among the results", () => {
    const result = mergeLookupSuggestions(
      [publicProfile({ displayName: "Someone Else", outboundLinks: [], slug: "someone-else" })],
      [privateCandidate({
        publicationState: "published_unclaimed",
        publishedProfileSlug: "basicbit",
      })],
    );

    assert.equal(result.length, 2);
  });

  it("prefers a public profile when only the spelling of the name differs", () => {
    const result = mergeLookupSuggestions(
      [publicProfile({
        displayName: "A_Roomba",
        outboundLinks: [{
          label: "VRCDN stream",
          source: "partner_provided",
          type: "vrcdn",
          url: "https://stream.vrcdn.live/live/aroombavdj.live.ts",
        }],
        slug: "a-roomba",
      })],
      [privateCandidate({ displayName: "A Roomba", fields: [{
        confidence: "medium",
        fieldKey: "outboundLinks",
        id: "roomba-links",
        reviewState: "unreviewed",
        sourceLabel: "NWinn",
        value: [{ type: "vrcdn", url: "https://stream.vrcdn.live/live/aroombavdj.live.ts" }],
        visibility: "private",
      }] })],
    );

    assert.equal(result.length, 1);
  });

  // Publishing to a matched profile leaves `proposedSlug` pointing at whatever
  // it originally asked for, which may be a slug another profile kept.
  it("ignores a published candidate's stale proposal when matching slugs", () => {
    const result = mergeLookupSuggestions(
      [publicProfile({ displayName: "Someone Else", outboundLinks: [], slug: "basicbit" })],
      [privateCandidate({
        displayName: "A Roomba",
        fields: [],
        proposedSlug: "basicbit",
        publicationState: "published_unclaimed",
        publishedProfileSlug: "a-roomba",
      })],
    );

    assert.equal(result.length, 2);
  });

  // Media links are validated by host, so the same recording can appear on two
  // people's profiles. Only account URLs stand in for a name.
  it("keeps differently named candidates that share only a media link", () => {
    const result = mergeLookupSuggestions(
      [publicProfile({
        outboundLinks: [{
          label: "YouTube",
          source: "owner_authored",
          type: "youtube",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        }],
      })],
      [privateCandidate({ displayName: "Someone Else", fields: [{
        confidence: "medium",
        fieldKey: "outboundLinks",
        id: "media-links",
        reviewState: "unreviewed",
        sourceLabel: "NWinn",
        value: [{ type: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }],
        visibility: "private",
      }] })],
    );

    assert.equal(result.length, 2);
  });

  it("keeps differently named candidates that only share a link anyone can post", () => {
    const result = mergeLookupSuggestions(
      [publicProfile({
        outboundLinks: [{ label: "Discord", source: "owner_authored", type: "discord", url: "https://discord.com/" }],
      })],
      [privateCandidate({ displayName: "Someone Else", fields: [{
        confidence: "medium",
        fieldKey: "outboundLinks",
        id: "shared-links",
        reviewState: "unreviewed",
        sourceLabel: "NWinn",
        value: [{ type: "discord", url: "https://discord.com/" }],
        visibility: "private",
      }] })],
    );

    assert.equal(result.length, 2);
  });
});
