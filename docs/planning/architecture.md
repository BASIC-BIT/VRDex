# Architecture Draft

## Recommended product shape

Build a small platform, not just a website:

- web app for public profiles and editing
- API for search, claims, and partner access
- Discord bot for lookup commands
- background workers for verification and sync jobs

Design assumption: the profile directory has two first-class profile types, `person` and `community`.

Design assumption: profiles are both identity records and customizable public pages.

Design assumption: worlds are separate domain records that can link to profiles, events, media, and creator-commerce links without becoming a third profile type.

## Suggested stack

### App stack

- `Next.js` or another React SSR framework for the web app
- `TypeScript` across web, API, and bot
- `PostgreSQL` for core relational data
- `S3` or `R2` for logos and media assets
- `Redis` for queues, rate limits, and cache if needed

Current likely stack direction based on adjacent repos and your preference:

- `Next.js` app on Vercel for web UX and preview environments
- `Convex` for backend data model, functions, auth-adjacent app logic, and scheduling
- `AWS` for SES auth email, private S3 asset storage, DNS-adjacent infrastructure, and surrounding infrastructure that fits better there
- `Stripe` for subscriptions, billing portal, and webhook-backed entitlement updates

### Auth

- support multiple login providers instead of treating Discord as the only account path
- Discord is the strongest early claim path, not the whole auth strategy
- app session auth using your normal preferred stack
- VRChat proof-code verification as a secondary claim path

Current recommendation:

- model authentication providers separately from verification and attestation sources
- locked v0.5 target is Discord, Google, and local email/password
- keep room for future providers beyond those
- keep room for native VRChat-linked trust if the platform makes that viable later
- require verified email before email/password accounts can perform claim-level actions

Email infrastructure direction:

- Amazon SES is the current default for verification and transactional mail; see `docs/deployment/ses-auth-email.md`

Asset infrastructure direction:

- private Amazon S3 is the first-pass direction for owner-authored profile assets; see `docs/deployment/aws-baseline.md`

### Billing

- Stripe as the initial billing system
- subscription and entitlement model designed early, even if premium features stay small at first

## Monorepo suggestion

Current bootstrap shape:

```text
vrdex/
  apps/
    web/
  convex/
  docs/
```

Candidate expansion later:

```text
vrdex/
  apps/
    web/
    bot/
  convex/
  packages/
    shared/
    config/
    ui/
  docs/
```

## Core domain model

### `profiles`

One row per person or community.

Implementation status:

- `#9` establishes one shared Convex `profiles` table
- `#10` adds globally unique canonical profile slugs and validation helpers
- `#11` adds discriminated person/community type-specific fields
- `#12` documents the profile read/write permission baseline
- `#13` documents claim-state transitions and trust-label helpers
- `#22` adds first owner-authored presentation fields for public pages
- `#23` adds the authenticated community submission mutation and source attribution baseline
- `#19` and `#21` add first public person and community profile routes
- account/user links, asset upload tables, moderation trails, and search-specific indexes are deferred to follow-on issues

Suggested fields:

- `id`
- `slug`
- `display_name`
- `sort_name`
- `profile_type`
- `person_type`
- `community_type`
- `bio`
- `headline`
- `timezone`
- `region`
- `claim_state`
- `visibility`
- `publication_state`
- `theme_preset`
- `accent_color`
- `avatar_border_color`
- `avatar_radius_percent`
- `avatar_asset_id`
- `banner_asset_id`
- `created_by_user_id`
- `claimed_by_user_id`
- `created_at`
- `updated_at`

Model rule:

- profiles are first-class entities separate from user accounts
- claim/ownership links attach a user to a profile record later
- the same profile record should survive community submission, concierge setup, unclaimed roster use, and later verified claim

Current recommendation:

- keep one shared core profile model
- treat `person` and a broader non-person bucket as the main split
- use `community` as the top-level non-person term, while still allowing subtypes like `club`, `collective`, `venue`, or `brand`
- subtype/category data for non-person entities should stay flexible rather than heavily enumerated early

Slug rule:

- `slug` should be a validated canonical handle chosen by the owner when possible
- it should be unique and independent from login/account identifiers
- VRChat display names can still be stored as aliases or search inputs

### `profile_aliases`

- alternate names
- old names
- searchable spellings

### `profile_links`

- normalized list of external links
- type examples: `twitch`, `soundcloud`, `mixcloud`, `booking_email`, `discord_user`, `discord_server`, `website`, `vrchat_group`, `gumroad`, `jinxxy`, `payhip`, `woocommerce`, `commissions`, `generic_store`

### `profile_blocks`

- ordered blocks for public pages
- examples: `links`, `bio`, `featured_event`, `featured_club`, `gallery`, `contact`, `availability`
- supports lightweight Linktree-like composition without raw HTML

### `profile_assets`

- logo assets
- banner assets
- avatar image
- maybe explicit license/usage notes
- source metadata like `uploaded`, `discord_import`, `vrchat_import`

Potential later addition:

- derived avatar-viewer assets generated from a safer presentation pipeline rather than storing/distributing a raw reusable avatar model

### `profile_genres`

- many-to-many between profiles and canonical genres

### `external_accounts`

- Discord account
- VRChat account
- Discord server
- VRChat group
- other auth/provider identities later (e.g. Google, X, local account bindings as needed)
- later VRCLinking or partner-linked ids

### `community_memberships` later

- links people to communities
- supports roles like `owner`, `resident`, `staff`, `founder`, `photographer`

Current recommendation:

- communities should also be able to attach unclaimed roster members so adoption does not require every person to sign up first
- keep this lighter in v1 unless stronger relationship semantics prove necessary

Candidate later direction:

- separate public affiliation/relationship edges from internal permission roles
- useful for graph views, collab history, and richer scene intelligence
- not yet justified as a hard v1 requirement

### `community_roles`

- community-scoped roles for management and collaboration
- likely starter defaults: `admin`, `mod`
- should be treated as default or seed roles, not necessarily permanent hard-coded product roles
- `owner` is not stored as an ordinary community role; it is the singleton ownership link for the community
- role assignments need active/revoked state and audit metadata so staff changes are reversible and explainable

### `community_role_permissions`

- capability mapping for community actions
- examples: edit profile, manage staff, manage events, transfer ownership, manage billing
- starter capability keys: `edit_community_profile`, `manage_roster`, `manage_events`, `manage_event_media`, `view_event_operations`, `manage_staff`, `manage_integrations`, and `manage_billing`

Current recommendation:

- `owner` is modeled as a special singleton ownership state, not just another ordinary role
- admins can manage billing by default
- dangerous ownership-sensitive actions should stay owner-only
- `manage_events` should authorize event CRUD, slot/lineup edits, event-world associations, and public event metadata
- `manage_event_media` should authorize private media-control commands, output setup, source routing, fallback publication, and worker lifecycle actions
- `view_event_operations` should allow read-only access to private current/next slot, readiness, source status, and command history without allowing writes

### `verification_events`

- who verified what
- when
- method used
- proof metadata

### `profile_field_visibility`

- field or block key
- visibility state (`public`, `unlisted`, `private`)
- updated by claimed owner

### `listing_opt_outs`

- records valid requests not to be publicly listed by third parties
- should support people and communities separately from ordinary profile privacy settings
- needs proof, scope, and audit metadata
- should suppress all public surfacing paths, not only dedicated profile pages
- should distinguish claimed-owner self-service opt-out from pre-claim moderation/safety suppression
- should support moderation state so pre-claim suppression can be handled case-by-case, with a simple visible-until-review fallback in MVP

### `profile_handoffs`

- concierge-created draft ownership transfers
- invitation token / recipient routing
- acceptance timestamp
- original curator id

### `profile_sources`

- records whether data came from owner entry, community submission, concierge setup, partner import, or AI suggestion
- helps drive trust labels and moderation policies

Related policy recommendation:

- ordinary community submissions should be schema-limited to a narrow safe field set
- owner-entered and concierge-confirmed data can support richer fields
- freeform public-submitted bio text should be avoided or strongly constrained in v1

### `worlds`

- public world records for VRChat worlds and event venues
- separate from `profiles` so person/community profile assumptions stay simple
- likely fields: `slug`, `displayName`, `sortName`, `summary`, `description`, `vrchatWorldId`, `canonicalVrchatWorldUrl`, `sourceUrl`, `visibilityStatus`, `platformCompatibility`, `publicationState`, `creationSource`, `createdAt`, and `updatedAt`
- supports public route `/w/<slug>`

### `world_media`

- hero image, screenshots, trailer/video links, or embeds
- should preserve source and permission policy
- avoid copying VRChat or creator media without a clear rights/source decision

### `world_links`

- owner-authored or reviewed outbound links for a world
- supports social, website, VRChat world link, and commerce/storefront links
- should not imply VRDex endorsement or verified sales

### `world_creator_attributions`

- connects worlds to person/community profiles or source text
- role labels can include `world_author`, `builder`, `venue_operator`, `community_operator`, `media_credit`, and `storefront_owner`
- attribution needs provenance, confidence, review state, and correction/dispute paths

### `world_sources`

- records whether world facts came from owner entry, community submission, concierge setup, partner data, manual review, or future API-compatible sync
- all imported/submitted facts should retain source and confirmation metadata

### `events`

- canonical event records shown on community pages and derived into person-facing participation views
- includes start/end, title, source, confidence, and linked entities
- should support separate poster, banner/hero, and thumbnail/card image slots with documented fallbacks

Implementation status:

- `events` stores canonical event data and readable `/e/<slug>` routing slugs
- `eventParticipants` links published person profiles to events with source and confirmation metadata
- `eventWorlds` links events to world records with source, confidence, and confirmation metadata
- `communityAuthorities` reserves a small capability-based seam for community-owned event management without implementing the full staff-role product yet
- `docs/backend/event-schema.md` is the backend reference for the first event foundation slice

Likely near-term additions:

- linked VRChat world id when known
- platform compatibility hints
- optional canonical event-level stream/watch metadata
- file-backed event assets that fill the same public poster, banner, and thumbnail slots

Current recommendation:

- once world pages exist, prefer an explicit event-world association over storing world context only as a raw event field

### `billing_customers`

- app user or organization to Stripe customer mapping
- stores Stripe ids and billing state metadata

### `subscriptions`

- plan id
- billing status
- renewal / cancel timestamps
- owner entity (person or community)

### `plan_entitlements`

- capability flags by plan
- examples: custom domain later, premium themes, analytics, advanced community tools, priority support

### `event_sources`

- raw source references from partner sync, manual entry, VRChat calendar, or AI extraction
- preserves provenance for trust and debugging

### `event_worlds`

- associates events to world records
- includes source, confidence, confirmation/review metadata, and optional notes
- enables world pages to derive upcoming/recent event views
- enables Home discovery modules to feature active worlds from VRDex event data without live presence tracking

### `event_participants`

- associates person profiles to events
- supports optional labels/notes
- remains the broad profile-event association layer even when detailed slot records exist
- enables person-facing derived event views without making "appearance" the core object

### `event_participant_notifications` later

- records when claimed people are notified about new event associations
- supports an in-app notification first, with room for richer delivery channels later

### `event_participant_disputes` later

- tracks when a person disputes an event association
- should allow temporary de-linking from the person's authoritative profile while preserving community-side source history

### `event_slots`

- structured performer slots within a larger event
- supports templated schedules like repeated 45-minute DJ sets or custom per-slot times
- stores canonical timestamps while Discord timestamp tokens are generated for display/export
- links to person profiles when known, but keeps a display label for unlinked or tentative performers
- confirmed slot performers are deduped into `event_participants` so person profile event views keep working

### `event_media_links`

- opinionated media/watch links for an event or slot
- examples: VRCDN PC, VRCDN Quest, Twitch, venue camera/watch feed
- should support typed common cases plus generic/other links
- should allow multiple links per event or slot
- public event pages promote a primary `watch`, `stream`, or `vrcdn` link into a watch surface only when the event has opted in and is inside the scheduled watch window
- provider embeds are allow-listed for YouTube, Twitch, and VRCDN; unsupported watch links remain outbound cards
- provider live/offline checks belong to the later restream/media-control model in `#124` and should not leak into viewer-facing explanatory copy

### `event_media_control` later

- event-scoped restream and one-link routing records should sit beside, not inside, the public media-link list
- sources can represent performer streams, VJ feeds, venue cameras, hold slates, intro/outro scenes, and direct public fallback links
- sources can attach to event slots so the current route can derive public `Now playing` from safe slot/profile state
- manual operator commands include preview, next, previous, custom source switch, hold current, hold slate, fallback publication, start, and stop
- automatic rules are separate from commands and should start as candidate policy, such as switching only when the next source is live and the current source is offline or over a configured grace period
- source status uses a small shared vocabulary: `current`, `next`, `live`, `offline`, `stale`, and `unknown`
- stale or unknown sources should not be automatic-switch targets without explicit operator confirmation
- media-control calls require a signed-in editor with event management authority, or a scoped event token for a worker, bridge, or approved command surface
- all accepted, rejected, and expired commands should write audit events with actor, token scope, command intent, result, and sanitized reason
- public projection is limited to safe watch links, public current performer labels, public profile imagery, and optional `Now playing`; private readiness, provider health, secret references, and command internals stay out of public pages

### `event_operations` later

- private operator view over canonical events, slots, participants, worlds, and media-control state
- roster rows show current, next, and upcoming slots with schedule times, overrun state, linked public profile, display label, and operator-only readiness
- readiness vocabulary starts small: `ready`, `needs_attention`, `not_ready`, and `unknown`
- source/operator status can reference the media-control vocabulary without exposing provider mechanics publicly
- manual actions include mark readiness, cue slot/source, hold current, show hold scene, preview source, publish fallback, copy Discord-ready output, and add private operator notes
- automatic signals are advisory until converted into an audited command by an operator or a separately configured rule
- authorization uses community capabilities: `view_event_operations` for read-only panels, `manage_events` for schedule/roster edits, and `manage_event_media` for source/output control
- optional local bridge signals from VRChat tooling can appear only as private operator hints with freshness and provenance, never as public attendance/readiness claims

### `entity_match_suggestions`

- stores LLM or rule-based candidate matches from event descriptions
- examples: performer name mentions, community mentions, set time extraction
- requires confirmation workflow before becoming trusted public data

### `moderation_flags`

- abuse, impersonation, suspicious link, toxic content, or mismatch signals
- can be raised by rules, LLM review, user reports, or admin actions

### `profile_revisions`

- immutable edit log for moderation and recovery

### `profile_credits` later

- event participation history
- residency history
- communities played
- references or endorsements

## Verification flows

### Discord verification

Best early claim path, but not the only identity path.

Flow:

1. User signs in with Discord
2. App stores Discord user id
3. If an existing profile already references that Discord id, the user can claim it
4. If no profile matches, the user can create one

For communities:

1. User signs in with Discord
2. User proves server ownership or sufficient admin rights
3. App links the Discord server to the community profile
4. Claim is granted or queued for review depending on trust rules

After claim:

- the community should support internal role assignment and delegated management
- ownership transfer should be explicit and auditable

### VRChat verification

Best secondary path for profile ownership.

Flow:

1. User requests a proof code
2. App generates a short one-time token
3. User places token in VRChat bio or another agreed visible profile field
4. Verification worker checks the visible profile data through your VRChat integration layer
5. On match, attach the VRChat identity to the profile and mark verified

For communities:

1. Generate a proof code for the community profile
2. Place it in a VRChat group announcement, description, or another agreed visible field
3. Verification worker checks the group metadata
4. On match, attach the VRChat group to the community profile and mark verified

Fallbacks:

- manual review
- partner attestation
- Discord plus moderator confirmation

## VRChat service-account exploration

Candidate direction:

- later VRDex operations may benefit from VRChat service/bot accounts for group- and instance-related features
- examples include opt-in invite workflows for running group instances, similar to how some ecosystem tools use bot-account fleets
- any such system should be treated as a specialized operational layer, not a v1 requirement

Important caveat:

- service-account fleet features add account management, group-capacity, safety, and abuse-surface complexity
- capture the idea now, but do not let it expand the first release scope

## Publication and authority model

Recommended distinction:

- community-submitted profiles are public but limited and explicitly unclaimed
- concierge drafts are richer but private until handed off and accepted
- claimed profiles are authoritative for owner-controlled fields

Opt-out rule:

- if a person or community has a valid listing opt-out, ordinary public community listing flows should not surface them in any public format
- this is stronger than hiding individual fields and should be modeled separately from profile visibility

Recommended search behavior:

- community-submitted profiles are searchable and discoverable
- claimed and verified profiles get higher ranking weight
- unclaimed profiles must carry clear trust labels in search cards and profile headers
- universal search uses `searchDocuments` across profiles, worlds, and events rather than scanning source tables directly
- deterministic reranking starts with exact, alias, tag, trust, freshness, and featured-placement signals
- `searchEmbeddings` creates a provider-neutral seam for later semantic/vector search provider evaluation

This prevents public seed data from feeling identical to owner-endorsed identity.

## Community permission model

Current recommendation:

- do not start with a giant freeform permission matrix
- model one special `owner` plus seeded familiar roles like `admin` and `mod`
- allow the non-owner role structure to evolve rather than treating every role name as permanently hard-coded
- use capability flags for actions and keep the first set intentionally small
- keep ownership transfer, owner removal, destructive community actions, and final sensitive billing authority owner-only
- split event authority into `manage_events`, `manage_event_media`, and `view_event_operations` so schedule editors, stream operators, and helpers do not need identical access

Reasoning:

- communities need delegation and ownership transfer early
- they probably do not need a full Discord-sized permission matrix in v1
- they do need a UX that feels familiar and low-friction

## Concierge onboarding model

Recommended flow:

1. curator creates a private draft
2. curator preloads assets, links, and likely metadata
3. system generates a handoff invite
4. recipient lands in a guided setup wizard
5. recipient confirms fields, privacy, and theme choices
6. profile becomes published only after acceptance

This gives you the high-touch onboarding you want without forcing the public submission flow to do too much.

## Integration plan

### Your existing VRChat MCP

Use `D:\bench\vrchat-mcp` as the integration reference, not necessarily as the production app itself.

Best reuse targets:

- auth and cookie-store patterns
- VRChat profile reads
- VRChat group reads
- local-first tooling for admin and support workflows

Event bridge boundary:

- local-only VRChat bridge tools may help an operator resolve VRChat users, groups, worlds, and event context to VRDex records
- a local bridge may provide private freshness-scoped hints such as `performer_maybe_in_instance` when the operator has appropriate local credentials and consent boundaries
- VRDex public pages, claim flows, and hosted services must not depend on private VRChat cookies or local presence checks
- bridge-derived signals are advisory operator context, not authoritative event facts or public readiness states

### VRC Pop

Best integration stance:

- consume event or community references if they offer a path
- give them canonical performer profile URLs to display
- give them canonical community profile URLs to display
- let communities import or link performer and community profiles instead of retyping bios and logos

### Decked Out

Best integration stance:

- let DJs bootstrap their public profile from Decked Out profile fields
- let Decked Out surface the public profile URL inside Discord embeds
- optionally let community-side event exports include performer slugs

Also useful:

- let Decked Out sync community identity basics into community profiles
- let community pages advertise "book via Decked Out" when linked

### VRCLinking / VRify style systems

Best integration stance:

- accept proven Discord-to-VRChat identity links when available
- do not force users to verify twice if a trusted integration can attest linkage

High-value uses:

- faster profile claim flow for people
- stronger evidence for community ownership and staff membership
- attested identity badges without needing to fully duplicate their linkage flow
- import of linked Discord user / VRChat user pairs where partnership allows

### Native VRChat Discord linking

Best integration stance:

- treat official VRChat account-linking as another trust signal when product surfaces allow it
- do not assume it fully replaces community tools like VRCLinking
- model attestations as source-based, so VRDex can accept evidence from multiple trusted systems

## Page customization model

Recommended v1 approach:

- preset-driven theming
- custom avatar/banner images
- ordered content blocks
- accent colors and a few layout variants

Target feel:

- closer to polished link-page builders like Linktree, Carrd, or guns.lol
- enough flexibility for personality and branding
- not full freeform web-page authoring

Avoid in v1:

- raw HTML embeds everywhere
- arbitrary CSS
- profile scripting

This keeps pages expressive, fast, safe, and mobile-friendly.

## Avatar viewer exploration

Candidate direction:

- if VRDex ever supports profile avatar viewing, prefer a derived presentation format
- an imposter-like or multi-angle sprite/render approach is more aligned with the anti-ripping goal than a normal browser glTF-style viewer
- this likely fits best as a later companion pipeline, potentially tied to a VCC plugin or creator-side export tool

Do not treat this as a v1 requirement.

## Documentation strategy

Use Docusaurus from day one as the main human-readable knowledge base in the repo.

Recommended structure:

- public product docs
- internal engineering / operations docs
- agent-facing notes that are still readable by humans

Docusaurus supports multiple docs sections cleanly through multiple docs plugin instances.

Suggested sections:

- `/docs` or root for public/product documentation
- `/internal` for engineering, operations, moderation, and agent notes

Important caveat:

- Docusaurus is static, so a route is not truly private by itself
- real privacy requires auth at the app/deployment layer or a separate internal deployment

Practical recommendation:

- keep one repo
- generate one public Docusaurus site for public docs
- either deploy a second internal docs build or gate `/internal` behind app auth if you integrate docs into the product shell

This works well with thin skills that mostly point agents to canonical docs pages instead of duplicating instructions.

## Testing and verification strategy

Recommended baseline from day one:

- unit tests for pure logic and transforms
- integration tests for backend flows and webhook handling
- Convex/backend tests for data mutations and permissions
- Playwright e2e for main user journeys
- Playwright visual snapshots for critical UI states
- VLM-assisted screenshot review whenever visuals change

Recommended supporting gates:

- TypeScript strictness and schema validation
- coverage reporting
- AST-grep or equivalent policy checks for code patterns
- unused dependency and dead-code checks
- PR preview verification against deployed environments when feasible

Nice-to-have automation loop later:

- auto-capture PR screenshot diffs as artifacts
- ask a VLM to summarize visual diffs
- capture short feature demo videos or GIFs for major UI changes

Adjacent repo signals:

- `meeting-notes-discord-bot` already demonstrates Stripe + AWS + Playwright visual + Storybook-style evidence loops
- `perkcord` already demonstrates Convex + Next.js + Stripe + visual confidence loops

VRDex can borrow heavily from both.

## Event ingestion model

`VRDex` should treat events as the primary layer, with person-facing participation views derived from event associations.

Primary source types:

- manual performer entry
- manual community entry
- trusted partner sync
- VRChat calendar/group event ingestion
- AI-extracted candidates from event descriptions

Important future-aware enrichment:

- VRChat world linkage and world preview
- compatibility guidance from linked world metadata
- slot extraction for multi-DJ events
- stream/media link normalization

Suggested confidence model:

- `manual_confirmed`
- `partner_confirmed`
- `ai_suggested`
- `ai_confirmed`
- `disputed`

AI should assist matching and extraction, not silently publish uncertain facts.

## Explicit non-dependency

- Do not make the product depend on VRCTL / vrc.tl access
- Do not plan around scraping blocked sites
- Treat third-party event data as optional enrichment only
- Do not base world discovery on private instance presence, scraped live player counts, or fixed-interval VRChat API polling

## Public surfaces to build early

### Public web page

- `/p/<slug>` for people
- `/c/<slug>` for communities
- `/w/<slug>` for worlds

Optional later:

- `/events/<slug>` or `/e/<id>` for canonical event pages

### Lightweight API

Canonical public API posture lives in `docs/developers/public-api.md`. This architecture sketch should not be used to add unversioned public routes.

Candidate read-only routes use the `/api/v0/...` prefix:

- `GET /api/v0/profiles/:slug`
- `GET /api/v0/search?q=`
- `GET /api/v0/cards/:slug`
- `GET /api/v0/communities/:slug`
- `GET /api/v0/worlds/:slug`
- `GET /api/v0/worlds/:slug/events`
- `GET /api/v0/worlds/active`
- `GET /api/v0/people/:slug`
- `GET /api/v0/people/:slug/events`
- `GET /api/v0/communities/:slug/events`

Public write routes remain out of scope until auth, rate limits, audit, and abuse handling are designed in a linked issue.

Public API posture:

- keep a documented public API for external consumers
- allow different rate limits or credentials for first-party web use, trusted partners, and general public clients
- prefer shared business logic even when transport/rate-limiting layers differ

### Discord bot

- lookup command returns a compact embed
- embed includes genres, contact path, verification badges, and canonical URL
- support both people and communities
- event-operations commands can start as interaction commands, buttons, selects, and modals over the same command model as the web control room
- a persistent Gateway service is still relevant for live event controls, ambient server monitoring, approved message ingestion, role sync, and richer event status workflows

### Restreaming and media control

- VRDex should act as the event media control plane before acting as its own delivery network
- first restream output should prioritize operator-owned VRCDN credentials and one composed stream pushed to VRCDN
- worker scale should track concurrent live programs; viewer scale should remain behind VRCDN or another delivery provider
- future VRDex-owned delivery needs explicit unit-economics, rights, abuse, support, and capacity planning
- local media-pipeline validation and cloud worker infrastructure design should proceed together before a real product PR is merged
- Discord live controls should prefer interaction embeds, buttons, selects, and modals over slash-command-only control flows
- detailed planning lives in `docs/planning/restreaming-media-control.md`

## Product rules worth encoding early

- unclaimed profiles are clearly labeled
- only claimed owners can change sensitive identity/contact fields without review
- deleted links and assets stay in revision history
- all assets should track uploader and upload time
- profile media-kit assets should be stored in VRDex-managed object storage; user-provided HTTPS image URLs are import sources, not canonical hotlinks
- person and community profiles share the same media-kit asset system for profile images, banners, primary logos, additional logos, and other reusable images
- DJ lookup surfaces should expose both profile image and logo when useful, with downloads for individual assets and all public logos
- community ownership should require stronger checks than ordinary profile edits
- private fields should still be usable for verification and owner workflows without leaking publicly

## Phased roadmap

### Phase 0: seed data and claims

- schema
- auth
- profile CRUD
- search
- claim flow
- community claim flow
- profile visibility controls
- file-backed profile image, logo, and banner uploads

### Phase 0.5: demoable pre-MVP

- polished public pages
- community submissions
- safe trust labeling
- first-run claim flow

Current target slice:

- person and community profiles
- claim flow
- privacy controls
- community submissions
- unclaimed search labeling
- basic event participation views

Deferred from this slice:

- billing
- notifications
- partner integrations
- AI extraction
- advanced community permissions beyond basics

### Phase 1: sharing and bot usage

- nice public profile page
- Discord unfurls
- Discord bot commands
- asset uploads
- logo downloads and media-kit asset lookup
- community pages
- theme presets and page composition blocks
- event participation on person pages
- basic public API foundation

### Phase 2: partner integrations

- import/export adapters
- event history and associations
- community-side profile references
- community intelligence summaries
- event feed imports
- AI-assisted event parsing and entity matching

### Phase 1.5: immediate follow-on

- notifications and approval settings
- richer event and participant structure
- world linkage and previews
- world pages, creator attribution, and event-derived active-world discovery
- creator commerce links and marketplace integration research
- stream/media normalization
- premium insights polish

### Phase 3: deeper graph

- crews
- residencies
- references
- portfolio pages
- analytics

## Strong product bet

Own the scene identity graph first.

If that wins, event discovery, staffing workflows, community tooling, and talent analytics become much easier to add later.
