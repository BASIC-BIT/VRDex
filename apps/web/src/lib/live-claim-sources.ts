/**
 * Link provenance a liveness claim may rest on.
 *
 * `community_submitted` is deliberately absent. `submitCommunityProfile`
 * publishes immediately, and a community submission is one signed-in person
 * adding somebody else's profile -- so a stranger could attach a channel or
 * stream they do not own and make an unclaimed profile announce that person is
 * live. No probe can catch that: somebody else's channel is a perfectly valid
 * channel and reports itself live while they are streaming. Only provenance can.
 *
 * The link still renders either way. It is the claim about *who* is streaming
 * that needs a vetted source.
 *
 * Shared by every provider rather than copied per provider, because the two
 * drifting apart is the failure mode -- VRCDN was gated here while Twitch was
 * not, and Twitch was the one also publishing a stream title and viewer count.
 */
const liveClaimLinkSources = new Set(["owner_authored", "partner_provided", "reviewed"]);

export type LiveClaimLink = {
  source: string;
  type: string;
  url: string;
};

export function carriesLiveClaim(link: LiveClaimLink): boolean {
  return liveClaimLinkSources.has(link.source);
}
