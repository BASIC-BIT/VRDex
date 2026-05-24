# Partner Opportunity Brief

## Purpose

Capture the current partner opportunity clearly enough to guide the next product conversation without turning partner notes into a heavy CRM or importing raw third-party data prematurely.

Public note: keep private partner names, local file paths, and raw source details out of public repo docs unless the partner has explicitly agreed to that public framing. Concrete local source details can live in private operator context.

## Status As Of 2026-05-24

### Warm DJ-List Partner

- Relationship state: warm lead, actively interested.
- Opportunity: a trusted partner has a master DJ links database of roughly 400 DJs and has explicitly permitted BASIC to use it for product discovery and a reviewed seed path.
- Product signal: this is unusually strong validation for VRDex's DJ/profile seed problem. It proves there is existing pain around maintaining structured DJ links and suggests the first useful artifact may be a cleaner management and handoff flow, not only a public profile page.
- Data boundary: do not commit the spreadsheet, local source path, or raw third-party DJ contact/link data. Treat it as a permissioned seed source that needs provenance, review, claim flows, and opt-out handling.

### DeckedOut / vrcpop Ecosystem Lead

- Relationship state: potential partner; start with a learning and integration-fit conversation before a concrete product ask.
- The ecosystem lead runs a VRChat event/community surface and is connected to DeckedOut and vrcpop workflows.
- Product signal: DeckedOut and vrcpop already touch booking, event, and DJ workflow surfaces. VRDex should keep positioning itself as the trusted identity/profile/presence layer and integrate where possible instead of trying to replace their booking or live-scene workflow first.

## Product Implications

- Partner seed import becomes strategically important: VRDex needs a way to ingest permissioned DJ/profile seeds while preserving provenance and avoiding accidental publication of sensitive or unconfirmed data.
- Concierge/handoff profiles matter more: a curated seed should become a draft or unclaimed profile that a DJ can review, claim, correct, hide fields on, or opt out of.
- Partner APIs should support profile seeds, event feeds, media links, and event-participant associations later.
- The product should avoid scraping-dependent or competitor-shaped behavior. The stronger angle is partnership, attribution, and portability.
- A partner list is not automatically consent from every DJ in the list. Public surfacing needs careful defaults, source labeling, and opt-out paths.
- Because likely partner surfaces may be built with AI coding agents, VRDex should eventually offer a portable skill/API/MCP integration kit that partner agents can consume directly instead of reverse-engineering VRDex behavior.

## Feature Opportunities To Discuss

### Restreamer / One-Link Stream Routing

Candidate direction:

- A community publishes one stable stream/watch link.
- Operators manage per-DJ stream links behind that public link.
- Switching can be manual first, then possibly automatic on scheduled set boundaries.
- Before switching, the system checks whether the next source is live.
- An operator dashboard shows current source, next source, live status, preview, and direct watch/Twitch links.
- VRDex event pages can expose the preview or Twitch/watch link directly from the website.

Boundary:

- This is probably not first-slice VRDex core. It should inform event media-link modeling and partner interviews before becoming infrastructure work.

### Discord Text To Structured Event

Candidate direction:

- Paste or ingest a Discord event announcement.
- Extract event title, community, date/time, DJ names, set times, stream/watch links, and source text.
- Match DJ names against known profiles or seed data.
- Queue uncertain matches for human confirmation before publication.

### Poster To Structured Event

Candidate direction:

- Upload or link an event poster.
- Extract visible DJ names and schedule text.
- Match names against the DJ/profile database.
- Queue candidate event and participant associations for review.

Boundary:

- Poster parsing should be treated as AI-assisted extraction with confirmation, not as authoritative identity or scheduling data.

## Next Conversation Targets

- Ask the DJ-list partner what fields in the list are most painful to maintain and what an ideal management UI would change first.
- Ask whether the first useful output is private list cleanup, DJ profile handoff, public pages, event parsing, or stream-link operations.
- Ask what consent expectations exist around using the list and whether any entries are sensitive, stale, private, or only meant for the partner's own operations.
- Ask the DeckedOut/vrcpop ecosystem lead what the existing tools already store and where repeated manual pain exists that VRDex should not duplicate.
- Ask where vrcpop-style integration would be welcome: profile links, event feeds, stream/watch links, roster/lineup data, or claim/identity signals.

## Near-Term Artifact Recommendation

Build a small internal prototype around the permissioned DJ list that proves the flow without committing raw data:

- inspect columns locally
- map fields to VRDex profile/event concepts
- create a tiny sanitized fixture with fake or explicitly approved sample rows
- sketch the import/handoff/claim states
- use that to drive the next partner conversation

## See Also

- `docs/planning/research.md`
- `docs/planning/product-spec.md`
- `docs/planning/prd.md`
- `docs/planning/epics.md`
