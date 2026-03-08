# Architecture Draft

## Recommended product shape

Build a small platform, not just a website:

- web app for public profiles and editing
- API for search, claims, and partner access
- Discord bot for lookup commands
- background workers for verification and sync jobs

Design assumption: the core directory has two first-class record types, `person` and `club`.

Design assumption: profiles are both identity records and customizable public pages.

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
- `AWS` for asset storage and any surrounding infrastructure that fits better there
- `Stripe` for subscriptions, billing portal, and webhook-backed entitlement updates

### Auth

- Discord OAuth for primary login
- app session auth using your normal preferred stack
- VRChat proof-code verification as a secondary claim path

### Billing

- Stripe as the initial billing system
- subscription and entitlement model designed early, even if premium features stay small at first

## Monorepo suggestion

```text
vrdex/
  apps/
    web/
    api/
    bot/
  packages/
    shared/
    config/
    ui/
  docs/
```

## Core domain model

### `profiles`

One row per person or club.

Suggested fields:

- `id`
- `slug`
- `display_name`
- `sort_name`
- `profile_type`
- `person_type`
- `club_type`
- `bio`
- `headline`
- `timezone`
- `region`
- `claim_state`
- `visibility`
- `publication_state`
- `theme_preset`
- `accent_color`
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

### `profile_aliases`

- alternate names
- old names
- searchable spellings

### `profile_links`

- normalized list of external links
- type examples: `twitch`, `soundcloud`, `mixcloud`, `booking_email`, `discord_user`, `discord_server`, `website`, `vrchat_group`

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
- later VRCLinking or partner-linked ids

### `club_memberships` later

- links people to clubs
- supports roles like `owner`, `resident`, `staff`, `founder`, `photographer`

Current recommendation:

- clubs should also be able to attach unclaimed roster members so adoption does not require every person to sign up first
- keep this lighter in v1 unless stronger relationship semantics prove necessary

Candidate later direction:

- separate public affiliation/relationship edges from internal permission roles
- useful for graph views, collab history, and richer scene intelligence
- not yet justified as a hard v1 requirement

### `club_roles`

- club-scoped roles for management and collaboration
- likely starter defaults: `admin`, `mod`
- should be treated as default or seed roles, not necessarily permanent hard-coded product roles

### `club_role_permissions`

- capability mapping for club actions
- examples: edit profile, manage staff, manage appearances, transfer ownership, manage billing

Current recommendation:

- `owner` is modeled as a special singleton ownership state, not just another ordinary role
- admins can manage billing by default
- dangerous ownership-sensitive actions should stay owner-only

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
- should support people and clubs separately from ordinary profile privacy settings
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

### `appearance_events`

- canonical event/appearance records shown on person and club pages
- includes start/end, title, source, confidence, and linked entities

Likely near-term additions:

- linked VRChat world id when known
- platform compatibility hints
- optional canonical event-level stream/watch metadata

### `billing_customers`

- app user or organization to Stripe customer mapping
- stores Stripe ids and billing state metadata

### `subscriptions`

- plan id
- billing status
- renewal / cancel timestamps
- owner entity (person or club)

### `plan_entitlements`

- capability flags by plan
- examples: custom domain later, premium themes, analytics, advanced club tools, priority support

### `appearance_sources`

- raw source references from partner sync, manual entry, VRChat calendar, or AI extraction
- preserves provenance for trust and debugging

### `appearance_notifications` later

- records when claimed people are notified about new appearance associations
- supports an in-app notification first, with room for richer delivery channels later

### `appearance_disputes` later

- tracks when a person disputes an appearance association
- should allow temporary de-linking from the person's authoritative profile while preserving club-side source history

### `appearance_slots` later

- structured performer slots within a larger event
- supports templated schedules like repeated 45-minute DJ sets or custom per-slot times

### `event_media_links` later

- opinionated media/watch links for an event or slot
- examples: VRCDN PC, VRCDN Quest, Twitch, venue camera/watch feed
- should support typed common cases plus generic/other links
- should allow multiple links per event or slot

### `entity_match_suggestions`

- stores LLM or rule-based candidate matches from event descriptions
- examples: performer name mentions, club mentions, set time extraction
- requires confirmation workflow before becoming trusted public data

### `moderation_flags`

- abuse, impersonation, suspicious link, toxic content, or mismatch signals
- can be raised by rules, LLM review, user reports, or admin actions

### `profile_revisions`

- immutable edit log for moderation and recovery

### `profile_credits` later

- appearances
- residency history
- clubs played
- references or endorsements

## Verification flows

### Discord verification

Best primary path.

Flow:

1. User signs in with Discord
2. App stores Discord user id
3. If an existing profile already references that Discord id, the user can claim it
4. If no profile matches, the user can create one

For clubs:

1. User signs in with Discord
2. User proves server ownership or sufficient admin rights
3. App links the Discord server to the club profile
4. Claim is granted or queued for review depending on trust rules

After claim:

- the club should support internal role assignment and delegated management
- ownership transfer should be explicit and auditable

### VRChat verification

Best secondary path for profile ownership.

Flow:

1. User requests a proof code
2. App generates a short one-time token
3. User places token in VRChat bio or another agreed visible profile field
4. Verification worker checks the visible profile data through your VRChat integration layer
5. On match, attach the VRChat identity to the profile and mark verified

For clubs:

1. Generate a proof code for the club profile
2. Place it in a VRChat group announcement, description, or another agreed visible field
3. Verification worker checks the group metadata
4. On match, attach the VRChat group to the club profile and mark verified

Fallbacks:

- manual review
- partner attestation
- Discord plus moderator confirmation

## Publication and authority model

Recommended distinction:

- community-submitted profiles are public but limited and explicitly unclaimed
- concierge drafts are richer but private until handed off and accepted
- claimed profiles are authoritative for owner-controlled fields

Opt-out rule:

- if a person or club has a valid listing opt-out, ordinary public community listing flows should not surface them in any public format
- this is stronger than hiding individual fields and should be modeled separately from profile visibility

Recommended search behavior:

- community-submitted profiles are searchable and discoverable
- claimed and verified profiles get higher ranking weight
- unclaimed profiles must carry clear trust labels in search cards and profile headers

This prevents public seed data from feeling identical to owner-endorsed identity.

## Club permission model

Current recommendation:

- do not start with a giant freeform permission matrix
- model one special `owner` plus seeded familiar roles like `admin` and `mod`
- allow the non-owner role structure to evolve rather than treating every role name as permanently hard-coded
- use capability flags for actions and keep the first set intentionally small

Reasoning:

- clubs need delegation and ownership transfer early
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

### VRC Pop

Best integration stance:

- consume event or club references if they offer a path
- give them canonical performer profile URLs to display
- give them canonical club profile URLs to display
- let clubs import or link performer and club profiles instead of retyping bios and logos

### Decked Out

Best integration stance:

- let DJs bootstrap their public profile from Decked Out profile fields
- let Decked Out surface the public profile URL inside Discord embeds
- optionally let club-side event exports include performer slugs

Also useful:

- let Decked Out sync club identity basics into club profiles
- let club pages advertise "book via Decked Out" when linked

### VRCLinking / VRify style systems

Best integration stance:

- accept proven Discord<->VRChat identity links when available
- do not force users to verify twice if a trusted integration can attest linkage

High-value uses:

- faster profile claim flow for people
- stronger evidence for club ownership and staff membership
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

`VRDex` should treat appearances as a unified layer assembled from multiple sources.

Primary source types:

- manual performer entry
- manual club entry
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

## Public surfaces to build early

### Public web page

- `/p/<slug>` for people
- `/c/<slug>` for clubs

Optional later:

- `/events/<slug>` or `/e/<id>` for canonical event pages

### Lightweight API

- `GET /api/profiles/:slug`
- `GET /api/search?q=`
- `GET /api/cards/:slug`
- `GET /api/clubs/:slug`
- `GET /api/people/:slug`
- `GET /api/people/:slug/appearances`
- `GET /api/clubs/:slug/appearances`
- `POST /api/appearance-suggestions/:id/confirm`

Public API posture:

- keep a documented public API for external consumers
- allow different rate limits or credentials for first-party web use, trusted partners, and general public clients
- prefer shared business logic even when transport/rate-limiting layers differ

### Discord bot

- lookup command returns a compact embed
- embed includes genres, contact path, verification badges, and canonical URL
- support both people and clubs

## Product rules worth encoding early

- unclaimed profiles are clearly labeled
- only claimed owners can change sensitive identity/contact fields without review
- deleted links and assets stay in revision history
- all assets should track uploader and upload time
- club ownership should require stronger checks than ordinary profile edits
- private fields should still be usable for verification and owner workflows without leaking publicly

## Phased roadmap

### Phase 0: seed data and claims

- schema
- auth
- profile CRUD
- search
- claim flow
- club claim flow
- profile visibility controls
- avatar/banner uploads

### Phase 0.5: demoable pre-MVP

- polished public pages
- community submissions
- safe trust labeling
- first-run claim flow

Current target slice:

- person and club profiles
- claim flow
- privacy controls
- community submissions
- unclaimed search labeling
- basic upcoming appearances

Deferred from this slice:

- billing
- notifications
- partner integrations
- AI extraction
- advanced club permissions beyond basics

### Phase 1: sharing and bot usage

- nice public profile page
- Discord unfurls
- Discord bot commands
- asset uploads
- club pages
- theme presets and page composition blocks
- appearances on person pages
- basic public API foundation

### Phase 2: partner integrations

- import/export adapters
- event appearance history
- club-side profile references
- club intelligence summaries
- event feed imports
- AI-assisted event parsing and entity matching

### Phase 1.5: immediate follow-on

- notifications and approval settings
- richer appearance/event structure
- world linkage and previews
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

If that wins, event discovery, staffing workflows, club tooling, and talent analytics become much easier to add later.
