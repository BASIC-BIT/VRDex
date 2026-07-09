# Home And Discovery Direction

## Status

Current recommendation from the July 9, 2026 product-design pass.

This document captures homepage, discovery, event-calendar, privacy,
personalization, and design-system implications that should not live only in
chat. For the broader product compass, see
`docs/planning/product-direction.md`.

## Why This Exists

VRDex has enough product surface area that the homepage can drift into several
different products:

- a direct search box
- a VRChat events calendar
- a Linktree-style profile directory
- a community discovery surface
- an operator utility for event and lineup work
- a marketable landing page

The current recommendation is to avoid treating those as equally important on
the first screen. The homepage should prove utility quickly, then let search
and profile pages handle direct lookup and deeper exploration.

## Product Bet

Current recommendation:

- VRDex should not be framed as only another event list.
- VRDex should still show event data prominently because event data is one of
  the fastest ways the identity graph becomes useful.
- The first strong product user is the event operator or lineup wrangler.
- The homepage should feel like a live scene utility, not a marketing page.
- Direct search should stay top-level and obvious, similar to a search engine:
  people use it when they already know what they want.
- Discovery should answer what is happening now or soon, what communities and
  worlds are active around those events, and which people are connected to
  those moments.
- Profiles, communities, events, worlds, links, slots, interest, follows, and
  provenance are the primitives. The homepage is one composition of those
  primitives, not the whole product.

The strongest near-term wedge looks like:

- "I need this person's links, logos, genres, contact path, and next events."
- "I need to know what is worth doing in VRChat tonight."
- "I need to publish or coordinate an event lineup without re-entering the same
  people and links everywhere."

## Existing Backlog Mapping

Verified against live GitHub issues on July 9, 2026.

Covered or partially covered:

- `#20` is closed: bounded customization and visual verification baseline.
- `#31` and `#33` are closed: public search and basic browse/discovery.
- `#80` is closed: Home active worlds / active venues module.
- `#89` is open: event interest, RSVP, and recurring event foundations.
- `#91` is open: friend-aware event discovery with VRChat social context.
- `#95` is closed: featured discovery placements and event poster wall
  foundation.
- `#119` is closed: DJ slot modeling and Discord timestamp helpers.
- `#120` and `#121` are open: AI-assisted event ingestion and Discord event
  export/publishing.
- `#122`, `#123`, and `#124` are closed: VRChat bridge evaluation, operator
  command roster, and restream/one-link media-control model.
- `#133` and `#134` are closed: shared media slots and public event watch/embed
  surface.
- `#138` is open: calendar import/export workflows.

Current gaps:

- no single issue or planning doc owned the homepage product bet after search
  and discovery landed
- no explicit internal persona/archetype document existed for homepage and
  discovery prioritization
- no issue captured a copy/taste review process for public homepage language
- no issue captured design-token maturity as a blocker for serious homepage
  theme exploration
- no issue focused specifically on VRChat group bot accounts, group event sync,
  invite workflows, and permission detection
- lineup coordination is partly covered by slot, ingestion, and export issues,
  but slot confirmation and "fetch everyone's approved links/assets" should be
  named more directly if that becomes a first-class operator workflow

## Homepage Strategy

Locked decision:

- Home should include a timeline-style surface for events happening today.

Current recommendation:

- The homepage should lead with utility, not explanatory product copy.
- Search should be prominent but not the entire homepage.
- A "today / tonight / soon" event schedule should be the strongest first data
  module when public event data exists.
- The value is the time-oriented view of what is happening when, not simply a
  list of event cards.
- The first shippable pass can be list-like if needed, but the target should be
  a proper schedule surface with set times where available.
- The schedule can link to a full-screen or full-page focused view.
- Community, world, and people modules should feel connected to real activity,
  not randomly advertised.
- Featured or curated placements should be secondary and honestly labeled.
- Anonymous visitors should still get value without onboarding.
- Signed-in visitors can get a more relevant sort, but the product should not
  require a manually customized dashboard to become useful.
- The public name should be chosen carefully; `timeline` may be too overloaded
  as a product term.

Avoid:

- a generic marketing hero that explains the platform before showing useful
  data
- opaque "recommended for you" copy
- random people or communities on the homepage without event, follow, search,
  or editorial context
- paid-promotion-looking placement before there is a clear policy and labeling
  model

## Search Versus Discovery

Locked direction from current implementation:

- `/search` is direct-intent lookup across public people, communities, worlds,
  and events.
- `/discover` redirects to `/`, so Home is already the discovery landing
  surface.

Current recommendation:

- Keep search terse and powerful.
- Use Home for the browseable "what is happening" layer.
- Let search query results be dense and direct.
- Let Home show timelines, cards, and follow/favorite context.
- Do not force operator workflows such as `/lookup` through the polished public
  discovery surface.

## Navigation Shape

Current recommendation:

- Use deeper, focused navigation when it preserves attention and task clarity.
- Home should not display every dataset VRDex knows about.
- Search, lookup, event schedule, profile, community, world, and operator
  routes can each optimize for different jobs.
- Dense operator surfaces should be allowed to exist without making public Home
  feel busy.

## Events Calendar Question

Current recommendation:

- Events should be front and center enough that a visitor can answer "what is
  happening tonight?"
- VRDex should compete on event usefulness, but not reduce itself to a VRCTL
  clone.
- The event calendar should be a proof point for the broader identity graph:
  people, communities, worlds, lineups, media links, and provenance all become
  more useful when attached to events.
- The first surface should prioritize local viewer time, current/soon state,
  host/community, world/venue when known, lineup/set times, watch/instance
  affordances when appropriate, and saved/followed context once available.

For public event schedule times, continue the existing app rule: render in the
viewer's local timezone and avoid duplicate canonical timezone lines unless the
user is authoring or debugging timezone behavior.

## Privacy And Personalization

Locked direction:

- Public discovery starts from explicit VRDex records, not scraped private
  presence.
- Opt-out and suppression must affect profiles, rosters, search, discovery,
  event participants, and similar public surfacing.

Current recommendation:

- Start personalization from explicit user actions: following a person,
  following a community, favoriting, marking interest, saving to calendar, and
  choosing onboarding interests.
- Follows, favorites, saves, and interest signals should be private by default.
- Aggregate counts can be shown publicly when they do not expose individual
  users, but owners should be able to hide or show those counts on their own
  profile or community page.
- Keep subtle personalization mostly as ordering, grouping, or "following
  first" behavior rather than overt recommendation copy.
- If an explanation is necessary, prefer plain labels such as `Following`,
  `Saved`, or `Tonight`, not "we think you will like this."
- Avoid user-level attendance, private presence, or "where you spent time"
  inference unless there is an explicit, consented, disconnectable integration
  and a strong privacy review.
- Friend-aware event context belongs behind `#91` and should never collapse
  friends, interest, attendance, and live presence into one ambiguous signal.

Avoid:

- public attendance claims without consent
- ranking that appears to advertise random people or communities to a viewer
- hidden data gathering that cannot be explained to privacy-minded VRChat users
- personalization labels that feel like ad-tech language

## Home Ranking Inputs

Candidate ranking signals, roughly from safest to riskiest:

- event start time and current watchability
- explicit event interest or RSVP
- followed or favorited people, communities, worlds, and genres
- calendar saves or subscribed feeds
- owner-authored or curated featured placements with honest labels
- tag/genre overlap from explicit onboarding choices
- public event co-occurrence and shared community graph signals
- friend-aware context from an explicit, opt-in social integration

Do not use these as early public facts:

- private VRChat instance presence
- private group membership inference
- user attendance inferred from background polling
- global popularity claims without safe documented data
- paid ranking mixed into organic discovery without clear labeling

## Archetypes

These are internal planning archetypes, not public labels.

### Friday-Night Raver

Observed workflow:

- opens the site before or during a VRChat night
- wants events happening now or tonight
- cares about DJs, set times, host community, watch/instance path, and favorite
  performers

Implication:

- the homepage should make tonight's schedule obvious
- favorites, follows, event interest, and set-time ordering are high-value
  features

Risk:

- overfitting to club/rave users could obscure broader community discovery

### Scene Explorer

Observed workflow:

- wants to find something interesting: yoga, chess, classes, social events,
  niche communities, worlds, or communities with shared interests

Implication:

- onboarding interest picks and browse facets can be valuable if they are calm
  and optional
- tags and category language should support non-club use cases

Risk:

- too many categories too early can become taxonomy work instead of product
  validation

### Newcomer

Observed workflow:

- has few existing scene ties and may have been brought into VRChat by someone
  else
- needs low-friction ways to understand what the scene has to offer

Implication:

- Home can offer broad interest picks, beginner-safe browse affordances, and
  non-club discovery without heavy onboarding copy

Risk:

- public pages must not imply that random community suggestions are personal
  endorsements

### Event Or Community Operator

Observed workflow:

- creates or promotes events
- needs a canonical community page, staff roles, event setup, lineup slots,
  media links, calendars, and possibly Discord or VRChat sync

Implication:

- this is the first user VRDex should optimize for
- community pages should front active or upcoming events
- event creation and event import/export are product-critical, not just admin
  tooling
- navigation can be deeper if each route maps to a concrete operator job

Risk:

- do not turn v1 into a full community-management suite before the core public
  utility is proven

### Performer Or Creator

Observed workflow:

- wants a profile that can replace repeated "send your links/logo/bio" moments
- wants control over what is public, unlisted, or private
- may care about upcoming events and media-kit assets more than directory
  browsing

Implication:

- the Linktree/media-kit value is real and should stay central
- profile customization should feel expressive but bounded

Risk:

- a profile graph can feel different from a simple link page; owners need
  privacy and publication controls to trust it

### Lineup Wrangler

Observed workflow:

- has a list of DJs, set times, or a poster and needs approved links, logos,
  genres, stream links, and Discord-ready output

Implication:

- `/lookup`, bulk lookup, slots, Discord timestamp helpers, and event export
  are a strong operator wedge
- slot confirmation should be considered as an operator workflow, not only a
  scheduling data model

Risk:

- this overlaps with booking products, so the first version should focus on
  link, asset, and schedule utility rather than full booking replacement

### Privacy-Sensitive Participant

Observed workflow:

- may object to being listed, tracked, ranked, or inferred
- may want profile benefits but not public discovery or contact exposure

Implication:

- field visibility, opt-out, suppression, consent, and provenance are not edge
  cases
- recommendation copy and analytics posture must be unusually careful

Risk:

- trust can be damaged quickly if VRDex feels like a data-gathering product

## Community And Event Pages

Current recommendation:

- A community page with an active or upcoming event should front that event.
- Active watch/instance surfaces should appear only when the event is actually
  watchable or actionable.
- Active instance display is a candidate direction, but it needs a verified
  source, consent/permissions model, and provider research before it becomes a
  public fact.
- Communities should feel like they receive useful public presentation and
  discovery value from maintaining VRDex records.

## VRChat Bot And Group Sync Direction

Candidate direction:

- VRDex may eventually use VRChat bot or service accounts for group-aware
  operational workflows such as invite routing, event sync, group event
  management, or permissions checks.
- This should be designed as an explicit integration lane, not as a hidden
  dependency of public discovery.
- If bot accounts can be granted community permissions, the product could
  detect missing permissions and show operators what needs to change.
- Bi-directional sync with native VRChat group events would be valuable if it
  is technically and policy-safe.

Open research:

- whether VRChat APIs and Terms support the desired bot-account actions
- how VRCTL-style group invite workflows actually work
- whether multiple bot accounts are needed because of group or rate limits
- what minimum permissions a community would need to grant for event sync,
  invite routing, or event management
- how self-hosted operators configure their own accounts without sharing
  credentials with VRDex

Guardrails:

- do not ask for or store user credentials
- do not make public discovery dependent on private VRChat session data
- keep bot permissions, actions, failures, and audit logs operator-visible
- separate native VRChat event sync from VRDex canonical event publication

## Club Management And Slot Confirmation

Candidate direction:

- Event slots can support a lightweight confirmation state for a performer.
- Confirmation can come from an invite/confirmation link, an operator-set
  checkbox, a partner import, or another reviewed source.
- Communities should be able to disable or simplify confirmation prompts when
  their workflow does not need them.
- Slothcast's `vrc.club` shutdown and backlash should be treated as an
  interview topic before copying assumptions from that workflow.

Non-goals for the first slice:

- full booking platform replacement
- mandatory performer accounts for every slot
- automatic publication of unconfirmed AI-extracted lineup data

## Participation, Slots, And Sets

Locked direction:

- Generic event participation is not the same thing as a role-specific event
  slot.

Current recommendation:

- A profile can be connected to an event broadly.
- A profile can also be connected to a specific slot with a role, time range,
  confirmation state, and source.
- DJ sets should be first-class enough for rave workflows, while the underlying
  model should also support dancers, VJs, hosts, photographers, classes, and
  non-club events.
- Set or performance artifacts should be able to attach to a person, an event,
  and optionally a specific slot.
- The first version should support external set links such as SoundCloud,
  Mixcloud, YouTube, archive links, or a performer's own site.
- Hosted DJ-set upload is a candidate direction, but it needs a separate design
  pass for quality, cost, copyright, moderation, takedowns, download controls,
  and self-hosting.
- Restream-derived automatic set capture is attractive but should not replace
  independent high-quality uploads. If it exists, it needs trimming, waveform
  review, silence snapping, explicit owner approval, and quality checks.

## Copy And Taste Process

Locked process for public homepage copy:

- Production homepage copy needs human taste review before merge.
- Copy should be sparse, direct, and human.
- Stand by the data rather than overexplaining the product.
- Avoid explaining every feature on the public page.
- Avoid implementation uncertainty in public copy.
- Avoid privacy reassurance essays; use product behavior and clear controls.
- Do not introduce generic AI-flavored value props.

Copy inventory that needs direct human review:

- homepage H1
- homepage subline
- search placeholder
- event section headings
- empty states
- trust labels
- CTA labels
- onboarding interest labels
- personalization labels
- community page active-event labels

Candidate copy posture:

- shorter is better
- concrete nouns beat abstract claims
- event utility beats platform explanation
- trust and privacy should be shown through controls and labels, not long
  speeches

## Design-System Implications

Current design-system maturity:

- VRDex has a useful Tailwind primitive foundation.
- It is not mature enough yet for serious homepage theme exploration.
- Color, font family, radius, and shadow tokens exist.
- Reusable primitives exist for shell, cards, buttons, badges, fields, notices,
  tables, and action cards.
- Many size, spacing, type-scale, density, and feature-specific visual choices
  still live as Tailwind literals or route-specific CSS.

Current recommendation before a major homepage redesign:

- expand semantic color tokens beyond the current warm palette
- define type scale, text roles, spacing steps, icon sizes, and layout widths
- add density rules for event schedules, compact cards, and operator views
- define entity-card primitives for person, community, world, and event cards
- define a homepage event timeline/list primitive with set-time support
- define theme presets as token mappings, not one-off page CSS
- add Storybook stories for homepage primitives before broad route redesign
- visually verify desktop and mobile homepage states with real screenshot
  evidence

## Issue-Ready Slices

### Mature web design tokens and homepage primitives

Disposition: new issue candidate.

Scope:

- define semantic tokens for colors, typography, spacing, radii, elevation,
  layout width, and density
- promote repeated homepage card, event-row, search, and entity-card patterns
  into shared primitives
- add Storybook coverage for new primitives
- keep token names domain-friendly and easy to theme

Related:

- `#20`
- `#95`
- `docs/engineering/design-system.md`

### Redesign Home around tonight/soon utility and direct search

Disposition: new issue candidate.

Scope:

- redesign the first viewport around direct search plus a today/tonight
  time-oriented event schedule
- make event schedule, set times, followed/saved context, active worlds, and
  featured placements fit one coherent information architecture
- cut marketing copy
- use screenshot and VLM review before calling the direction complete

Related:

- `#31`
- `#33`
- `#80`
- `#89`
- `#95`
- `#133`
- `#134`

### Product personas and taste interview pack

Disposition: new issue or docs task candidate.

Scope:

- turn the archetypes in this doc into a small internal personas reference
- add a copy/taste worksheet for homepage and profile language
- keep persona names internal and neutral
- capture direct human answers before production copy is finalized

### Event interest, follows, favorites, and subtle ranking

Disposition: extend `#89` or split a follow-up if it grows.

Scope:

- model explicit interest, follows, favorites, and saved calendar signals
- define how those signals sort Home without creepy copy
- keep individual signals private by default
- define owner controls for aggregate counts
- preserve privacy, opt-out, and deletion boundaries

Related:

- `#89`
- `#91`
- `#138`

### VRChat group bot, native events, and invite workflow research

Disposition: new issue candidate.

Scope:

- research bot/service-account feasibility for group event sync, invite
  workflows, permissions detection, and native VRChat event management
- document provider/TOS constraints
- define self-host setup expectations
- keep the output as a go/no-go or phased recommendation

Related:

- `#16`
- `#91`
- `#122`
- `#123`

### Lineup coordinator and slot confirmation workflow

Disposition: new issue candidate or extension of event-operation work.

Scope:

- design slot confirmation states and confirmation links
- support operator override for trusted/reliable performers
- connect bulk lookup, slots, Discord timestamp export, and approved media-kit
  links into one operator workflow

Related:

- `#119`
- `#120`
- `#121`
- `#123`

### Set and performance artifact links

Disposition: new issue candidate or extension of existing event-slot/media
planning.

Scope:

- model external set links attached to people, events, and slots
- support provider types such as SoundCloud, Mixcloud, YouTube, archive, and
  generic website links
- decide public display rules across person profiles, event pages, community
  pages, and lookup/operator views
- keep hosted uploads as a later, separate research-heavy issue

Related:

- `#119`
- `#124`
- `#133`
- `#134`

### Hosted DJ set upload and restream capture research

Disposition: new research issue candidate.

Scope:

- evaluate hosted audio upload cost, playback quality, encoding, storage,
  egress, moderation, takedowns, rights, download controls, and self-hosting
- compare independent uploads against restream-derived capture
- define trimming and waveform-review UX needs
- decide whether this belongs in core VRDex, a premium tier, a self-hosted
  module, or a later companion service

## Interview Later

- What should the today/tonight event schedule surface be called if not
  `timeline`?
- What homepage copy feels like "us" and what phrases immediately feel fake?
- Which aggregate counts should be visible by default, owner-hidden by default,
  or never public?
- What exact behavior would feel creepy in event recommendations even if it is
  technically allowed?
- What quality bar would performers require before trusting hosted set
  playback?
- What did `vrc.club` users object to, and what should VRDex avoid learning the
  hard way?
- What VRCTL workflows should be studied through human conversation rather
  than product scraping?

## Open Research

- VRCTL bot/group invite mechanics.
- VRChat bot/service-account permissions and policy.
- Native VRChat event management possibilities without user credentials.
- VRC Pop dashboard customizability and how much of that is user-authored
  versus system-provided.
- Slothcast / `vrc.club` backlash and operator workflow lessons.
- Whether broad non-club communities show real latent demand for VRDex profiles
  and events, or whether the first market should stay DJ/event-heavy.
