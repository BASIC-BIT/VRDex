# World Discovery And Creator Attribution

## Status

Current recommendation. This lane was seeded after `#36` made world linkage an event extension but before worlds became first-class product surface.

Related issues:

- `#79` - world discovery and creator attribution epic
- `#84` - world profile schema and public world page
- `#81` - event-world associations and active-world views
- `#80` - Home page Hot Worlds / Active Venues module
- `#82` - creator commerce links on profiles and world pages
- `#83` - marketplace API integration research

## Product Bet

VRChat events are not only about people and communities. They happen in places built by creators, operated by venues, and reused across scenes.

VRDex should make worlds visible enough that a fan can answer:

- where is this event happening?
- who built or operates that world?
- what other events happen there?
- where can I find the creator's public work, store, or commission links?

This is a discovery lane, not a replacement for VRChat's own world pages or creator storefronts.

## Principles

- Worlds should be separate domain records, not a third `profileType` squeezed into person/community profile assumptions.
- Every world fact needs provenance, especially creator attribution, platform compatibility, media, and commerce links.
- Early activity and Hot Worlds surfaces should be event-derived, curated, owner-authored, or partner-provided with review.
- Do not depend on scraped global popularity, private instance presence, fixed-interval VRChat polling, or blocked sites.
- Do not imply VRChat endorsement, VRDex endorsement, verified sales, or verified ownership unless the source supports that claim.
- Marketplace integrations should start as owner-authored external links before any API sync.

## World Profile Foundation

Candidate first slice for `#84`:

- `slug`
- display name
- short summary or description
- `vrchatWorldId` when known, using the `wrld_...` identifier format
- canonical VRChat URL, preferably `https://vrchat.com/home/world/<worldId>`
- optional `https://vrch.at/<worldId>` display link
- source URL provided by the owner, community, or partner
- tags and vibe labels
- optional visibility/status hint such as `unknown`, `private`, `community_labs`, or `public`
- optional platform compatibility hints when sourced
- media such as hero image, screenshots, trailer/video links, or embeds
- owner-authored outbound links
- creator attribution links to person/community profiles
- source/provenance fields for each imported or submitted fact

World pages should be reachable at a stable public route such as `/w/<slug>`.

> **Update 2026-08-11:** superseded. Profiles, worlds, and events are now first-class root links at `/<slug>`, sharing one global slug namespace. The `/p/`, `/c/`, `/w/`, and `/e/` prefixes were removed outright with no redirect. The text below is kept as the record of what was planned at the time. See `docs/backend/profile-slugs.md` for the live contract.

## Creator Attribution

Creator attribution should use explicit roles instead of one ambiguous owner field.

Candidate role labels:

- `world_author`
- `builder`
- `venue_operator`
- `community_operator`
- `media_credit`
- `storefront_owner`

Attribution must be owner-entered, partner-provided, or reviewed. Automatic inference from posters, names, screenshots, or event text is not authoritative enough for public creator credit.

Locked decision for the first reciprocal profile slice:

- person and community profile pages can show world credits derived from published world creator attributions
- reciprocal profile credits require indexed `profileSlug` and `profileType` records; display-name-only credits remain world-local source text
- draft worlds and non-public world records do not appear on public profile world-credit sections

## Event-World Graph

Candidate first slice for `#81`:

- an event can link to a world profile
- the event-world link carries source, confidence, and confirmation metadata
- world pages can derive upcoming and recent events from those links
- active-world queries can sort by upcoming event count, next event time, recency, or curated feature status
- event-derived activity should be labeled honestly, such as `Upcoming on VRDex`, `Active soon`, `Curated`, or `Partner-provided`

Locked decision for the first implementation slice:

- public world pages only render published events through confirmed event-world associations
- unconfirmed, disputed, draft, or private event-world records are not public world-page activity
- event source URLs are filtered to `https` before publication
- event-world confidence is stored for review/ranking work, but public copy should emphasize confirmation state instead of implying attendance or live popularity

Do not call early results global popularity unless the ranking is backed by safe, documented, permissioned data.

## Home Discovery Module

Candidate first slice for `#80`:

- show Hot Worlds, Active Venues, or Worlds Hosting Events Soon on Home
- each card can include world title, media, creator attribution, event context, and a call to action
- empty states should still make the product feel intentional when there are no world/event records
- the first ranking rule should be explicit event-world associations, not live VRChat data

Locked decision for the first implementation slice:

- Home labels this module `Featured worlds`, not `Hot Worlds` or `Live now` — BASIC
  moved it off `Worlds hosting events soon` on 2026-08-05, onto one of the safer
  labels already listed below, and dropped the supporting line and the per-card
  event count with it
- cards are built from published events with confirmed event-world links
- the first sort is earliest next event time, not global popularity or attendance
- unconfirmed, disputed, draft, or private records do not contribute to Home world activity

Safer labels for v1:

- `Active soon`
- `Hosting upcoming events`
- `Featured worlds`
- `Curated venues`

Riskier labels to avoid until justified:

- `Most popular in VRChat`
- `Live now`
- `Trending globally`
- `Top by attendance`

## Creator Commerce Links

Candidate first slice for `#82`:

- support typed owner-authored commerce links on person, community, and world pages
- include generic commerce links for unsupported storefronts
- distinguish owner-authored links from imported, reviewed, or partner-provided links
- render commerce links without implying VRDex endorsement or verified sales

Locked decision for the first implementation slice:

- person and community profile links are typed external links, not checkout or marketplace sync
- profile and world link publication filters out non-`https` URLs
- public copy labels owner-authored, reviewed, or partner-provided links without implying sales verification

Candidate link types:

- Gumroad
- Jinxxy/Jinxie
- Payhip
- WooCommerce or personal store
- Ko-fi
- Patreon
- commissions
- generic product/store link

Commerce links are a presentation feature first. Checkout, fulfillment, taxes, refunds, licensing, and sales analytics are non-goals for the first slice.

## Marketplace API Research Summary

Current recommendation for `#83`:

Detailed gate: `docs/planning/marketplace-api-research.md`.

- Gumroad is the best first API-sync candidate because it has OAuth scopes and product/listing read endpoints.
- Use minimum scopes for storefront display. Do not request or store sales, payout, tax, buyer, license, or order data for a public storefront card.
- Jinxxy/Jinxie should stay owner-authored links until official API docs or written integration guidance are available.
- Payhip should stay owner-authored links for storefront sync because the available API appears narrow and does not provide general product/listing reads.
- WooCommerce has mature APIs, but every store is its own security and performance boundary. Defer until VRDex has a general external-store connector model.

Any future sync must support explicit creator opt-in, encrypted server-side credential storage, disconnect/token deletion, conservative polling/backoff, last-synced labels, and tests that prevent sensitive transaction fields from being persisted.

Disallowed fields for public storefront sync unless a separate privacy-reviewed feature exists:

- buyer names
- buyer emails
- IP addresses
- order ids
- license keys
- payout data
- tax data
- raw webhook payloads
- transaction rows

## VRChat Data Boundary

World pages can store and link public VRChat world identifiers when provided by owners, communities, partners, or reviewed submissions.

VRDex should not require undocumented VRChat API usage for core world discovery. If future API-compatible fetching is added, it needs:

- no VRChat credentials, cookies, or service-account shortcuts for public discovery
- clear `User-Agent`
- aggressive caching
- jittered schedules
- backoff on `429` and errors
- disableable/self-host-configurable sync
- documented source and timestamp labels

Unsafe early data sources:

- scraped live player counts
- private or group instance presence
- user-level attendance/presence
- fixed-interval VRChat API polling
- hidden group membership inference
- creator/operator inference from names or media without review
- copied media without permission or source policy

## Recommended Sequence

1. Land this planning doc and wire it into the planning index, product spec, PRD, architecture, epics, issue seeding, and dependency map.
2. Implement `#84` with a separate `worlds` model and `/w/<slug>` public page. (Shipped; the route later became `/<slug>` — see the update note above.)
3. Implement `#81` with event-world associations and derived world upcoming-event views.
4. Implement `#80` using explicit event-world data and honest labels.
5. Implement `#82` as typed owner-authored commerce links.
6. Treat `#83` as a research gate before any marketplace API sync issue is opened.
