# Event operator and live playback gap assessment

Status: research findings and current recommendations, not an approved implementation design.

## Evidence boundary

Inspected local main at `13f6ad64a`. Existing unrelated working-tree changes were left alone.
The public `GET https://vrdex.net/api/v0/events/upcoming?limit=3` returned
`{"events":[]}` during this investigation. This proves that read endpoint responds;
it does not prove authenticated authoring, event detail rendering, or stream playback
works in the deployed environment. No event was created or published.

## What exists

- Community-context creation and community-scoped public/edit routes are documented in
  [event routing and authoring](event-routing-and-authoring.md).
- Browser creation supports draft and publish, scheduled rows, person lookup,
  freeform display labels, and other participants. See
  `apps/web/src/app/events/event-editor-form.tsx`.
- Community owners and staff with `manage_events` can manage browser events.
  The API/MCP create path uses `requireApiOwnedPublishedCommunity`, so staff
  parity must not be assumed. See `convex/events.ts`.
- Public event responses and pages contain the community, scheduled performers,
  profile links, and viewer-local times. See `convex/_eventPublic.ts:325` and
  `apps/web/src/app/_components/event-public-page.tsx:387`.
- Hosted MCP source registers `vrdex_get_event`, `vrdex_list_upcoming_events`,
  `vrdex_event_create`, and `vrdex_event_update`. The current workspace's
  `.codex/config.toml` enabled-tools list excludes all four. No config was changed.
  Live tool advertisement and granted event-write scopes remain unverified.
- The event watch panel embeds an event-level stream. It receives event media
  links, not performer slots. See `event-watch-surface.tsx:367`.

## Gaps for the first useful operator workflow

1. Expose and verify event reads in the actual MCP client. Verify write tools,
   scopes, and community ownership separately before attempting publication.
   MCP create currently creates and publishes, unlike browser draft authoring.
2. Join scheduled performer identities to their current public outbound links.
   Event slot projections currently contain identity and image summaries only.
   An agent could compose event lookup with one profile read per unique performer;
   the website needs a corresponding event-level presentation.
3. Show schedule order, performer, public links, and PC/Quest stream copy actions
   together. Preserve unresolved/freeform performers rather than guessing identities.
   Deduplicate profile reads while retaining every scheduled appearance.
4. Reuse the profile visibility projection. Event-manager authority must not expose
   private person fields. `convex/_profilePublic.ts` already projects visible links.
5. Define the selected stream per scheduled appearance if a performer has several.
   Recommend automatic selection only when there is one unambiguous supported stream,
   with an organizer selection when ambiguous. Never select an arbitrary first URL.
6. Verify one real community event end to end once separately authorized, including
   public discovery, detail page, performer links, and MCP readback.

## Live playback recommendation

Locked decision: BASIC approved automatic advancement enabled by default on the
event page. Starting playback should feel like joining the live event in-world,
with no separate opt-in to follow the lineup. Manual selection with a way to
return to live playback remains a current recommendation. Silence thresholds
remain unvalidated and distinct from disconnection handling.

Start with a local browser player and default automatic handoff, with manual
performer selection available. Reuse the existing VRCDN player. Do not require a media
worker just to change which public source one browser plays.

For contiguous slots, arm the next source two minutes before the boundary. Once
armed, switch only after a sustained qualifying failure and when the next source
is playable. One second is the user's proposed debounce, not a verified reliability
threshold. Recovery before the threshold resets the timer. Before eligibility,
recover the current stream rather than advancing the lineup. Pausing or muting is
not a broadcast failure. A failed next source must not cause an automatic skip.

For gaps and overlaps, a conservative candidate is to arm at the later of
`current.endAt - 2 minutes` and `next.startAt - 2 minutes`. Missing boundaries and
multiple simultaneous performers need explicit handling; do not invent times.
Keep the actually selected source separate from the slot currently indicated by
the clock, so an overrun does not silently replace playback state.

The existing watch window closes at event end, with a six-hour fallback for missing
end times. That conflicts with retaining an overtime broadcast and needs an explicit
end-of-event rule before this behavior ships.

Connected but silent audio is a separate candidate trigger. The user's intended
semantics remain open. Initial recommendation is to prove stopped-playback handling
first, then add measured audio silence if wanted. Local playback failures do not
prove the broadcaster stopped.

Browser-local switching affects each viewer independently. It cannot switch a
VRChat world player or provide a single continuous restream URL. Those outcomes
still require a shared control/output path.

See [browser handoff research](event-client-handoff-research-2026-09-12.md) for
provider format, autoplay, silence measurement, and restream code findings.

## Suggested order

First make an event useful as a complete operator link sheet and public schedule.
Then prove viewing of its scheduled VRCDN sources and add automatic handoff as
the default event-page experience, with dropout, overtime, next-source readiness, pause,
autoplay rejection, and background-tab cases tested in real browsers.

No paid-tier requirement is inferred from the phrase "pro version" in this discussion.
