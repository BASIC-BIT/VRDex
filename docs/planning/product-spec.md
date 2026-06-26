# Product Spec

## Working title

VRDex

Working domain: `vrdex.net`

## Product thesis

VRChat scene participants need one canonical, public, claimable profile system for people and communities. VRDex should make those profiles trustworthy and reusable, with enough customization and link depth to replace ad-hoc link pages.

World discovery extends that identity graph by showing where events happen, who built those spaces, and how creators can link to their work.

## Primary users

### DJs and performers

They want one link they can send when communities ask for:

- logo and other media-kit assets
- social links
- stream link
- preferred genres
- short bio
- booking contact
- VRChat identity

They also want:

- a customizable public page
- a primary display image, logo, and banner
- optional privacy for sensitive details
- an event list showing where they are playing next

### Club owners and bookers

They want to quickly answer:

- who is this person
- what do they play
- how do I contact them
- are they verified
- what assets can I use in promo material

They also want to quickly answer:

- what is this community's Discord
- what VRChat group is this tied to
- who runs it
- where do I submit events or applications
- what kind of nights do they host

### Clubs and groups

They want a canonical page for:

- community identity
- links and contact info
- Discord server and VRChat group presence
- lineup style and genres
- recruitment or booking info
- trusted ownership signals
- upcoming events and recent activity
- roster and affiliated talent over time

### Community members

They want to add missing performers even before those performers sign up themselves.

### World builders and venue operators

They want people to understand:

- what world or venue an event uses
- who built or operates that world
- what other events happen there
- where to find store, commission, product, or portfolio links

## Product principles

1. Profiles are public by default; ownership is explicit
2. Community submission is allowed; claiming is protected
3. Verification increases trust but is not required to exist
4. The product is identity-first, not booking-first
5. Integrations matter more than lock-in
6. People and communities are first-class entities
7. Every profile field can be hidden by its owner after claim
8. Visual customization should feel expressive without breaking usability
9. Agents and partner systems should be first-class API/docs consumers, not forced to scrape or infer product rules from undocumented conventions
10. Worlds can become a first-class discovery lane without becoming unreviewed popularity scraping

Current recommendation on terminology:

- use a shared identity/profile system for both people and non-person entities
- internally, `community` is currently the stronger candidate term for the broader non-person bucket
- publicly, the product does not need to force one rigid umbrella word into the UX everywhere
- subtype/category choices should stay flexible and not become an over-prescriptive taxonomy in v1

## MVP scope

### 1. Public profile pages

Each profile should support:

- profile type (`person` or `community`)
- display name
- aliases
- short bio
- preferred genres or identity tags
- hometown / region / time zone
- contact methods
- file-backed profile image, logo, and banner assets
- downloadable media-kit assets, including a primary logo and additional logos
- social links
- stream links where relevant
- VRChat account or VRChat group link
- Discord account or Discord server link status
- verification badges
- block-based link sections for Linktree-like usage
- owner-configured visibility per field

Import helpers should support:

- Discord avatar / banner / display name when available
- linked-account identity metadata from VRCLinking when available
- VRChat profile or group metadata when available
- manual uploads as the highest-control option

Authentication direction:

- users should not be forced into Discord as the only login path long-term
- the system should leave room for multiple auth providers and local credentials
- identity verification and ownership proof should stay source-based rather than tied to one login vendor

Locked v0.5 target:

- support Discord login
- support Google login
- support email/password login

Current recommendation:

- email/password accounts should verify email before profile claim actions are allowed
- AWS-backed email delivery is the likely implementation direction

### 2. Community-created profiles

Any logged-in community member can create a draft profile for an existing person or community.

Rules:

- clearly mark as unclaimed until verified
- preserve edit history
- keep a visible source note for who added it
- allow moderation rollback
- restrict which fields can be set by ordinary community submissions
- avoid presenting unclaimed data with the same authority as claimed profiles
- respect opt-out requests that block unwanted third-party listing

Current recommendation for allowed fields:

- display name
- aliases
- genre/tags
- public links
- logo/image
- source note

Current recommendation for disallowed fields:

- private contact information
- anything implying verified ownership or official endorsement
- likely freeform bio text in v1, unless it is constrained into a safer structured format

### 2a. Concierge / handoff profiles

Trusted operators should be able to create a richer draft for someone else and hand it to them.

Use cases:

- onboarding a DJ or community personally
- preparing a polished starting page before launch
- importing known basics and giving the owner a guided confirmation flow

Rules:

- concierge drafts stay non-public until accepted or explicitly published
- the recipient gets a first-run wizard rather than being dropped into the full editor immediately
- prefilled fields should be editable, confirmable, or removable by the owner
- concierge origin should be tracked for auditability

### 2b. Partner and list seed imports

Trusted operators should be able to turn permissioned external lists into reviewed profile seeds without treating the source as authoritative public truth.

Use cases:

- importing a partner-maintained DJ links list
- preparing private concierge drafts for DJs before launch
- seeding unclaimed profiles with safe public fields and visible provenance
- mapping partner records to existing claimed or unclaimed VRDex profiles

Rules:

- raw partner spreadsheets and raw third-party contact/link exports must not be committed to the repo
- imports should preserve source, import batch, reviewer, and confidence metadata
- imported records should default to draft/private or clearly labeled unclaimed states until publication is deliberate
- sensitive fields should require review before public display
- DJs and communities need claim, correction, visibility, and opt-out paths
- partner-provided data should never bypass owner visibility controls after claim

### 3. Claim flow

The owner can claim an existing profile by proving identity.

Claim methods:

- Discord OAuth for people
- VRChat proof code placed in bio or another visible profile field for people
- Discord server ownership or admin verification for communities
- VRChat group verification for communities
- moderator/manual override as fallback

Current recommendation:

- Discord can be the strongest first claim path, but not the only long-term login or trust path
- future auth/login options may include Google, local credentials, X, and native VRChat if a viable OAuth path exists later
- official VRChat Discord linking, VRCLinking, and direct proof flows should all be treated as distinct trust signals

First-run claim UX should support:

- accepting a concierge draft
- reviewing prefilled fields one step at a time
- choosing what becomes public immediately
- selecting a theme before landing in the full editor

### 4. Share page / media kit page

Every profile should have a clean shareable page optimized for:

- community staff
- Discord unfurls
- mobile viewing
- "send me your links" moments
- event runners grabbing approved logos and promo assets

Style expectations:

- strong visual identity
- avatar + banner presentation
- media-kit asset section for logos and other reusable images
- avatar frame controls for border on/off, border color, border thickness, soft feathered border glow, and square-to-circle roundedness
- theme presets with accent colors and section ordering
- no requirement for users to hand-code CSS

Community pages should also support:

- event submission link
- staff contact path
- booking form or booking contact
- genre / vibe summary
- partner links

### 5. Search and discovery

Search by:

- name
- alias
- profile type
- genre
- verified status
- region / time zone
- platform tags

Search and browse should also support:

- who is playing soon
- communities by genre / vibe
- performers by upcoming events
- worlds hosting upcoming events
- curated or event-derived active venues

Implementation status for the first discovery engine slice:

- home is moving toward search-first discovery instead of treating search as a secondary directory link
- universal search is backed by `searchDocuments` for profiles, worlds, and events
- search ranking starts with deterministic exact, alias, tag, trust, freshness, and featured signals
- `searchEmbeddings` is a provider-neutral seam for later semantic/vector search
- featured placements can front event posters, festivals, worlds, communities, and profiles without unsupported global popularity claims
- PostHog discovery events are optional and no-op when analytics config is absent

Current recommendation for genre graph metadata:

- treat genres as canonical graph metadata, not only freeform profile tags
- use MusicBrainz genre UUIDs as the initial canonical external anchor where available, with VRDex-owned IDs and slugs for product stability
- store genre aliases as indexed records so `Drum & Bass`, `D&B`, `DnB`, and `dnb` resolve to the same canonical genre
- store typed genre edges such as `subgenre_of`, `fusion_of`, `influenced_by`, and weak `adjacent_to` relationships for later browse and recommendation systems
- keep profile tags and canonical genres separate so identity/vibe labels do not pollute the genre ontology
- design genre picker UX around broad first choices, direct alias search, inferred parent genres, and capped related suggestions rather than a tiny flat list or an overwhelming global taxonomy browser
- use manual/contact genre requests as the first niche-genre escape hatch before building full user-generated canonical genre submission flows
- see `docs/planning/genre-graph.md` for the research notes and suggested data shape

Current recommendation for lookup mode:

- add a separate `/lookup` utility for operator-style person lookup rather than forcing every workflow through the polished profile/discovery UI
- keep lookup output dense and tabular: name, aliases, genre context, public VRDex path, and public outbound links
- avoid profile-page headline or bio copy in lookup rows; personal flair belongs on the profile page unless it is encoded as concise genres or operator-useful links
- source lookup results from the same public profile/search data, with the same suppression and field-visibility boundaries as ordinary public surfaces
- treat VRChat, Discord, SoundCloud, Mixcloud, Twitch, YouTube, Spotify, Bandcamp, Instagram, Linktree, website, store, and booking links as first-class profile link types
- render non-primary lookup links as icon-only actions. Elevate VRCDN stream controls first; Twitch stays icon-only unless the profile link explicitly requests copy-row presentation, because some DJs prefer event organizers to use VRCDN over Twitch.
- derive a VRCDN preview action from any public VRCDN stream link instead of requiring a duplicate stored preview link.
- keep recent lookup terms local to the browser, deduped, and capped to a small list for quick operator reuse.
- support a bulk lineup paste mode that looks up each pasted line as provided, with a later LLM-assisted cleanup pass as a candidate direction for messy schedule text and poor matches
- do not expose auth-provider account metadata, private claim evidence, or hidden verification details in lookup rows
- use a compact icon-only checkmark for verified lookup/profile rows, with accessible label or tooltip text for meaning and no visible `Verified` word in dense operator layouts

Current recommendation for opinionated DJ/club surfaces:

- keep the underlying profile model people/community-oriented, but allow public surfaces to use DJ/club language when the workflow is clearly DJ-scene-specific
- preserve the generic directory/search product, but do not force every task through a generic view when a DJ-centric operator mode is more useful
- treat `/lookup` as the first example of an opinionated task mode: dense public DJ links for lineups, bookings, and set-time operations
- consider future modes for DJ roster filtering, club lineup planning, media-kit collection, and event-slot operations if the user base proves to be mostly clubgoers, DJs, and organizers

### 6. Discord bot integration

First commands should be simple:

- `/dj <name>`
- `/club <name>`
- `/links <name>`
- `/logo <name>`
- `/genre <name>`

### 7. Basic community intelligence

MVP-adjacent but worth designing early:

- upcoming events count
- linked Discord server
- linked VRChat group
- roster of known residents or affiliated performers
- basic activity summary when integrations exist

Club management direction:

- one owner in v1
- familiar starter roles like `admin` and `mod`
- unclaimed roster members allowed so communities can use the system before full ecosystem adoption

Candidate later workflow direction:

- private notes on people or communities for operator-side relationship management
- invite/accept participation flows for events
- possible open signup flows for some events
- these features may be native later or may be better solved through Decked Out integration

### 8. Events and participant history

Person profiles should support:

- upcoming events they are associated with
- recent event history
- event cards with community, title, time, and source
- source attribution for each event association

Sources can include:

- self-submitted event links
- community-submitted event associations
- partner sync from Decked Out or VRC Pop
- partner seed imports or permissioned DJ-list records
- Discord event text pasted or ingested by an operator
- VRChat calendar and group events
- AI-extracted candidate event associations from event descriptions
- AI-extracted candidate event associations from posters or event images

Current recommendation for initial event fields:

- title
- community
- start time
- end time optional
- source
- link optional
- notes optional
- poster/image optional

Implementation status for the first event foundation slice:

- events use editable readable slugs under `/e/<slug>`
- generated durable `/l/<code>` short links are deferred to `#92`
- public person pages derive upcoming events from confirmed `eventParticipants` links
- public community pages derive hosted upcoming events from canonical event records
- participant role labels are freeform text for now; reusable vocabulary memory is deferred to `#90`
- `eventSlots` adds ordered DJ/set-time records under canonical events for `#119`
- first-pass slot generation uses minute offsets from the event start, slot count, slot duration, and optional break duration
- Discord timestamp tokens are generated from canonical event/slot timestamps for display/export, not stored as canonical time data
- approval, dispute, notification, RSVP/interested, recurring event, and friend-aware discovery flows are deferred to follow-up issues

Important future-aware extensions:

- VRChat world linkage
- platform compatibility hints
- richer DJ slot breakdowns and booking-manager UX beyond the first `#119` slot editor
- stream/watch link modeling
- set/performance artifacts that can attach an external or hosted recording to a specific event slot
- calendar import, export, and sync, preserving static `.ics` export, later Google Calendar sync, and reviewed Google Calendar import; see `docs/planning/calendar-integration.md`

Event media direction:

- use shared media slots across people, communities, worlds, and events instead of adding unrelated image fields for every surface
- event `poster` remains flyer-style artwork, while `banner` is the event-page hero and `thumbnail` is the compact card/discovery image
- event banners fall back to posters; thumbnails fall back to posters and then banners
- event cards can reuse discovery-visible community, person, and world images for hosts, lineup, and place cards without exposing private, unlisted, or non-public media
- uploaded/managed assets should eventually fill these slots, with external URLs treated as import sources when rights and source policy are clear

Event-world direction:

- worlds should become separate public records rather than being stored only as event text
- event-world links need source, confidence, and confirmation metadata
- world pages can derive upcoming and recent event views from those links
- active-world surfaces should start from explicit event-world associations, curated picks, or reviewed partner data instead of scraped popularity

### 8a. World discovery and creator attribution

World pages should support:

- display name, summary, tags, and media
- VRChat world id and canonical VRChat world URL when known
- creator attribution to people or communities with role labels
- venue/community association where appropriate
- upcoming or recent events derived from event-world associations
- owner-authored outbound links
- source/provenance for every imported or submitted fact

Current recommendation:

- keep `world` as a separate domain object, not a third profile type inside person/community profile assumptions
- preserve provenance and review state for creator attribution
- avoid live instance/player-count claims in the first slice
- avoid copying creator media unless rights/source policy is clear
- see `docs/planning/world-discovery.md`

Streaming and media direction:

- some events need multiple media links with different compatibility behavior
- examples include VRCDN PC links, VRCDN Quest links, Twitch watch links, and venue camera/watch links
- v1 should use typed media links for common cases while still allowing generic/other links
- multiple media links should be supported where operationally useful
- public event pages should promote one primary watch source only when the event has opted in and a `watch`, `stream`, or `vrcdn` link is eligible during the watch window
- YouTube, Twitch, and VRCDN are the first embed targets; unsupported watch providers should still get a prominent outbound watch card
- event pages should not claim a stream is live until a provider status adapter confirms liveness

Candidate restreamer / one-link routing direction:

- some communities may want one stable public stream/watch link while operators manage per-DJ source links behind it
- the media-control model should treat performer stream links, VJ feeds, venue cameras, hold slates, and direct fallback links as event-scoped sources that can optionally attach to event slots
- manual operator controls come first: preview a source, switch to next, switch to previous, switch to a custom source, publish a fallback link, hold the current source, or move to a hold slate
- automatic switching should remain a candidate layer, separate from manual controls, with rules such as `next performer live and current offline`, or `current slot over grace period and next performer live`
- source status should distinguish `current`, `next`, `live`, `offline`, `stale`, and `unknown`; automatic rules should not switch to an unknown source without operator confirmation
- fallback behavior should prefer holding the current source when safe, otherwise move to a hold scene or direct public fallback link while keeping private source-health detail in the operator view
- control operations should require an event-scoped key or scoped token tied to an operator, worker, Discord command surface, or bridge, with all accepted/rejected commands recorded in an audit trail
- restream output should reuse the public watch surface instead of creating a separate viewer path; public pages can show `Now playing` from the current slot, public performer profile display name, and safe thumbnail/banner imagery without exposing private readiness or provider health
- this should inform event media-link modeling and operator-dashboard interviews before becoming first-slice streaming infrastructure

Candidate set/performance artifact direction:

- performers may eventually post recordings of sets, initially as external links such as SoundCloud, Mixcloud, YouTube, or archive links
- a later hosted-media option could store the performance itself, but only after rights, consent, moderation, cost, and takedown policy are designed
- the important product concept is that an event slot can later resolve to a specific performance artifact, preserving who played, when, where, and what recording represents that slot
- this should remain a later media/event graph feature, not a requirement for the initial DJ lookup or slot editor slices

Notification and consent direction:

- when a claimed person is added to an event association in v1, they should get a passive in-app notification
- people should be able to choose a notification-oriented preference in v1
- stronger approval-before-display settings are desirable later but not required for the first release
- if an event association is disputed, a likely interim behavior is to keep the community-side slot while removing the authoritative link to the person's main profile until resolved

### 9. Identity attestation integrations

Strong candidate for early partnership value:

- accept trusted Discord-to-VRChat linkage from VRCLinking where available
- accept trusted Discord-to-VRChat linkage from native VRChat where available
- use that linkage to reduce manual claim friction for people
- use it as supporting evidence for community staff and ownership checks
- show an attested-link badge separate from native verification

### 10. Privacy controls

After a profile is claimed, the owner can set field-level visibility for any detail.

Visibility states to support:

- `public`
- `unlisted`
- `private`

Examples:

- keep the profile public but hide booking email
- keep Discord linked for verification but not display it publicly
- hide location or time zone if the owner prefers

Suggested default behavior:

- claimed owners can control every field
- ordinary community submissions only populate a safe subset of public-facing fields
- concierge drafts can prefill more, but the recipient confirms before publication

### 10a. Listing opt-out controls

People and communities should be able to opt out of unwanted third-party listing.

Current recommendation:

- a valid opt-out should prevent that person or community from being surfaced publicly by third parties regardless of format
- opt-out should be treated separately from normal field privacy because it is about whether the listing should exist at all
- normal self-service opt-out should require profile ownership/claim
- pre-claim suppression should be handled as a verified moderation or safety request instead of ordinary self-service account control
- ideal handling is case-by-case based on abuse risk, with a simpler leave-visible-until-review fallback for MVP if detection is not mature yet
- details of scope and proof still need product interview work

### 11. Profile customization

Owners should be able to customize their page with:

- avatar / display picture
- banner image
- accent color or theme preset
- section order
- featured links
- featured event or featured community
- optional gallery or media blocks later

Customization target:

- closer to Linktree, Carrd, or guns.lol than MySpace
- strong personality and visual control
- no raw HTML or CSS in v1

Low-priority exploration:

- optional avatar showcase module later
- likely driven by a safer derived representation, not raw avatar asset delivery to the browser

### 12. Authority and publication model

Suggested profile states:

- `draft_private`
- `concierge_pending`
- `community_unclaimed`
- `claimed_unverified`
- `claimed_verified`

Display guidance:

- `draft_private` and `concierge_pending` are never public
- `community_unclaimed` can be visible and searchable, but must be clearly labeled
- claimed profiles get stronger trust presentation and search prominence

Profile model rule:

- a profile exists independently from the user account that may later claim it
- claims attach authority to an existing profile record rather than redefining the profile itself
- this allows community-added entries, concierge drafts, roster references, and event links to stay stable over time

Search guidance:

- unclaimed community profiles may appear in search and discovery
- they must show a visible unverified/community-submitted badge
- help text should explain that the profile is based on third-party information until claimed
- claimed and verified profiles should rank above otherwise similar unclaimed results
- valid opt-out cases should be excluded from ordinary public discovery flows, including profile pages, public roster displays, and public event participant references

### 13. Club role model

Current recommendation:

- `owner` is the only reserved role
- communities should start with familiar defaults such as `admin` and `mod`
- other role structure should be allowed to evolve instead of being hard-coded forever
- admins should be able to manage normal billing workflows by default
- ownership transfer should require acceptance by the new owner

Relationship modeling note:

- public affiliation/relationship types may be valuable later, especially for graph-style views and scene history
- that model is not yet settled and should not be overdesigned into v1 by default
- a simpler roster model may be the better first slice

### 14. Abuse review and AI assistance

AI can help with:

- abuse screening on submitted bios and links
- detecting suspicious impersonation or mismatch signals
- parsing Discord event text into candidate structured events, set times, DJ names, and media links
- extracting lineup names and schedule text from event posters/images
- checking event-description extraction candidates
- flagging profiles that need manual review

AI should not be the sole authority for identity or moderation decisions.

### 15. Avatar viewer R&D

Candidate direction:

- support a profile avatar viewer later for creators who want to show off their VRChat avatar
- prefer a derived viewer format that is harder to rip than delivering the source avatar model directly
- likely implementation path is closer to an imposter or multi-angle sprite system than a traditional downloadable web 3D model viewer

This is explicitly low priority relative to identity, claims, communities, and events.

## Explicit non-goals for MVP

- full event scheduling platform
- full community management suite
- replacing Decked Out's booking workflow
- replacing VRC Pop's live scene visualization
- replacing VRCLinking's role-sync depth
- any dependency on VRCTL / vrc.tl access
- scraped world popularity, private instance presence, or user-level attendance tracking
- marketplace API sync, sales analytics, or checkout inside VRDex before a separate privacy-reviewed integration design exists
- unconstrained HTML/CSS profile editing in v1

## Suggested profile fields

### Identity

- display name
- sortable name
- aliases
- pronouns
- country / region
- time zone
- languages

### Performer info

- performer type (`dj`, `vj`, `live performer`, `host`, `photographer`, later expandable)
- primary genres
- secondary genres
- vibe tags
- set length preferences
- platform support (`PC`, `Quest`, `Desktop` relevance if needed)
- equipment notes optional

### Club info

- community type (`venue`, `collective`, `brand`, `community`, `agency`)
- primary genres
- secondary genres
- vibe tags
- event cadence
- booking status
- recruitment status
- linked Discord server
- linked VRChat group
- staff contacts
- resident roster later

### Contact and links

- booking email
- Discord handle or deep link
- website
- Twitch
- YouTube
- SoundCloud
- Mixcloud
- Bandcamp
- X / Bluesky / Instagram optional
- custom links with labels
- creator commerce links such as Gumroad, Jinxxy/Jinxie, Payhip, WooCommerce/personal store, Ko-fi, Patreon, commissions, or generic product/store links

### VRChat-specific

- VRChat user id or canonical profile URL if available
- VRChat display name
- VRChat group affiliations optional
- world or community affiliations optional

For communities:

- VRChat group id
- VRChat short code if relevant
- default venue world links optional

### Assets

- shared profile asset system for people and communities
- true file upload and managed download support, backed by owned object storage such as S3
- public HTTPS import-by-download, where user-provided external image URLs are fetched into VRDex storage rather than hotlinked as the canonical asset
- profile picture / avatar placement
- banner placement
- primary logo placement
- additional ordered logos, avoiding "alternative" terminology in user-facing copy
- loose owner/community-provided labels and optional public captions
- support for using the same uploaded asset as both profile picture and primary logo
- PNG and SVG logo support from day one
- download individual assets and download all public logos as a zip
- DJ lookup/card surfaces should show profile image and logo side by side when the layout has room, collapsing gracefully when they are the same asset
- compact surfaces can use a profile-level display preference with an automatic default: profile image first, logo when no distinct profile image exists or when the owner picks logo-first display
- owner appearance controls can style the avatar frame without changing the underlying uploaded asset
- press kit PDF/one-sheet export later

### Visibility metadata

Every field or block should support owner-configured visibility and source attribution.

## Verification states

- `unclaimed`
- `claimed_unverified`
- `discord_verified`
- `vrchat_verified`
- `identity_attested`
- `fully_verified`

## Core flows

### Flow A: Person creates own profile

1. Sign in with Discord
2. Create profile
3. Add links, logo, genres, bio
4. Verify VRChat account with proof code
5. Share profile URL

### Flow B: Community member creates a profile for a person

1. Sign in
2. Create an unclaimed profile for a performer
3. Add basic info and sources
4. Performer later claims it
5. System merges claimant identity with existing entry

### Flow C: Club owner checks a person profile

1. Search performer name
2. See verification state, genres, links, logos, contact path
3. Download individual logo assets or all public logos as a zip
4. Open the canonical share page for the broader media kit

### Flow D: Community claims its own community profile

1. Staff member signs in with Discord
2. Claims the community page through Discord server ownership/admin path
3. Links VRChat group
4. Adds branding, genres, booking info, and staff contacts
5. Shares the community profile as the canonical public page

### Flow E: DJ keeps a public page but hides sensitive details

1. DJ claims profile
2. Imports Discord avatar and uploads a custom banner
3. Sets booking email to private
4. Leaves genres, links, and upcoming events public
5. Shares the page publicly without exposing everything

### Flow F: Event association gets added from multiple sources

1. A community submits an event or a partner sync imports one
2. System attaches source metadata
3. AI optionally extracts likely performer names and set times from the description
4. Suggested matches are confirmed by a user, community owner, or moderator
5. The event shows on the community page and on associated person profiles

## Trust and moderation rules

- show who created an unclaimed entry
- show last updated timestamp
- keep revision history for contested edits
- restrict certain sensitive fields after claim
- allow report / correction requests
- clearly mark AI-extracted event links as suggested, confirmed, or disputed

## API goals

Public read APIs should eventually support:

- profile lookup by slug
- search by genre / name
- profile card JSON for bot responses
- profile media-kit assets, including primary plus additional logos and download URLs
- embeddable link previews
- events feed for a person or community
- world lookup by slug or VRChat world id
- event-derived active-world and world-event feeds
- agent-oriented compact responses for common profile, event, and media-link lookups

Current recommendation:

- public API and frontend-facing API may share underlying business logic while still having independent rate limiting and client treatment
- trusted partner clients may later receive different limits than unknown third-party scrapers
- API docs should be usable by humans and agents, including machine-readable schema docs and short task-oriented examples

Agent integration surface goals:

- publish a portable VRDex skill that other repos can install or point their agents at
- include API usage guidance, website navigation guidance, trust/provenance rules, and MCP direction in that skill's references
- consider agent-friendly docs such as `llms.txt`, route maps, and compact API examples once the public docs site exists
- make AI-coded partner projects better-integrated by default instead of requiring each partner agent to rediscover VRDex conventions
- see `docs/planning/agent-integration-surface.md`

Partner APIs later:

- import performer or community profile seeds
- sync events and event-participant associations
- sync verification hints
- sync community metadata from trusted partners
- accept identity attestations from VRCLinking
- accept event feeds and event-participant confirmations from trusted partners
- support agent/MCP clients with scoped read and write operations where appropriate
- allow partners to integrate through public API, portable skill guidance, or MCP without being locked into one agent tool

MCP direction:

- a standalone VRDex MCP is a strong later candidate, especially for public profile/event lookup and partner integration workflows
- optional VRChat MCP bridge tools may also be useful later for resolving VRChat context to VRDex records
- keep the standalone VRDex surface separate by default so VRDex's public data and claim operations do not become coupled to VRChat cookie-based local auth
- model the tool design after VRChat MCP's curated-tool philosophy: small explicit tools, human-friendly inputs, compact outputs, IDs for follow-up, and clear not-found guidance

### Open platform posture

Locked direction:

- the system should be open source
- self-hosting should be a real supported path
- API behavior and limits should be documented publicly
- infrastructure should be reproducible from the repo

## Success criteria for MVP

- a DJ can send one URL instead of five
- a community can find and trust a profile quickly
- community members can seed the directory without waiting on every performer
- communities can use a public page as their identity hub
- at least one external bot or site can consume profile data
- users can hide any claimed profile detail they do not want public
- fans can visit a profile and see upcoming events without leaving the page
