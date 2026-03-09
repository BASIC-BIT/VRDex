# Product Spec

## Working title

VRDex

Working domain: `vrdex.net`

## Product thesis

VRChat scene participants need one canonical, public, claimable profile system for both people and communities that other people can trust and reuse, with enough customization and link depth to replace ad-hoc link pages.

## Primary users

### DJs and performers

They want one link they can send when communities ask for:

- logo
- social links
- stream link
- preferred genres
- short bio
- booking contact
- VRChat identity

They also want:

- a customizable public page
- a primary display image and banner
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

## Product principles

1. Profiles are public by default; ownership is explicit
2. Community submission is allowed; claiming is protected
3. Verification increases trust but is not required to exist
4. The product is identity-first, not booking-first
5. Integrations matter more than lock-in
6. People and communities are first-class entities
7. Every profile field can be hidden by its owner after claim
8. Visual customization should feel expressive without breaking usability

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
- logo and banner assets
- primary display image / avatar
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

Style expectations:

- strong visual identity
- avatar + banner presentation
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
- VRChat calendar and group events
- AI-extracted candidate event associations from event descriptions

Current recommendation for initial event fields:

- title
- community
- start time
- end time optional
- source
- link optional
- notes optional
- poster/image optional

Important future-aware extensions:

- VRChat world linkage
- platform compatibility hints
- DJ slot breakdowns within a larger event
- stream/watch link modeling

Streaming and media direction:

- some events need multiple media links with different compatibility behavior
- examples include VRCDN PC links, VRCDN Quest links, Twitch watch links, and venue camera/watch links
- v1 should use typed media links for common cases while still allowing generic/other links
- multiple media links should be supported where operationally useful

Notification and consent direction:

- when a claimed person is added to an event association in v1, they should get a passive in-app notification
- people should be able to choose a notification-oriented preference in v1
- stronger approval-before-display settings are desirable later but not required for the first release
- if an event association is disputed, a likely interim behavior is to keep the community-side slot while removing the authoritative link to the person's main profile until resolved

### 9. Identity attestation integrations

Strong candidate for early partnership value:

- accept trusted Discord<->VRChat linkage from VRCLinking where available
- accept trusted Discord<->VRChat linkage from native VRChat where available
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

- display picture / avatar
- square logo
- transparent logo
- promo banner
- profile image
- press kit zip later

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
3. Copy assets or open canonical share page

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
- embeddable link previews
- events feed for a person or community

Current recommendation:

- public API and frontend-facing API may share underlying business logic while still having independent rate limiting and client treatment
- trusted partner clients may later receive different limits than unknown third-party scrapers

Partner APIs later:

- import performer or community profile seeds
- sync events and event-participant associations
- sync verification hints
- sync community metadata from trusted partners
- accept identity attestations from VRCLinking
- accept event feeds and event-participant confirmations from trusted partners

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
