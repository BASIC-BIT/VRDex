# Event Programming, Unclaimed Media, And Profile Visibility Slice

## Status

Planning baseline for implementation from `origin/main` at
`ba7230e6c1559c76e98633f7da1bd0a1d9374b60`, verified on 2026-08-25 and
saved on 2026-08-26.

Locked decision:

- Event programming and discovery, the public-profile visibility contract, and
  reviewed media contributions for unclaimed profiles will ship as one
  cohesive product slice in one pull request.
- The pull request may use ordered commits and internal checkpoints, but it is
  not complete until the full public and operator workflow is integrated.
- This slice does not expand VRDex into a general social network, booking
  platform, attendance tracker, or hosted-media platform.

Current recommendation:

- Implement authorization and visibility foundations first inside the branch,
  then event programming, then private media review, then integrated rollout.
- Keep public presentation calm and data-forward. Do not introduce substantive
  public copy without BASIC approving the exact wording.

## Product Outcome

This slice should let a community operator publish a useful event program with
time slots and linked DJs, while letting an authenticated contributor safely
propose an image for an unclaimed profile without publishing it directly.

The result connects three existing VRDex strengths:

- public profiles are reusable identities for people and communities
- event slots make a lineup useful at a specific time
- reviewed profile media gives event organizers dependable images without
  giving arbitrary users control of somebody else's presentation

The public proof is concrete data: what is happening, when it is happening in
the viewer's local time, who is playing, and which approved profile information
and media can be reused.

## Evidence Baseline

### Verified current capabilities

- `convex/schema.ts` already defines canonical events, participants, ordered
  slots, worlds, calendar-import staging, event publication state, slot review
  state, IANA timezones, community authority capabilities, profile field
  visibility, owner media assets, upload intents, and profile audit events.
- `convex/_eventPublic.ts` publishes only published events and confirmed
  associations.
- Public event pages, event/profile associations, Discord timestamp output, and
  single-event ICS export already exist.
- Public event and slot times already render in the viewer's local timezone.
- `apps/web/src/app/_components/discovery-public-page.tsx` has an event module,
  but it presents generic previews rather than a useful time-oriented program.
- Owner media-kit flows already provide upload intents, source preservation,
  MIME and size validation, direct-upload quarantine, HTTPS import protection,
  content hashes, display derivatives, metadata, placements, quotas, ordering,
  featured state, deletion, and restore.
- Existing profile corrections let an authenticated contributor update a
  bounded set of fields on a public unclaimed profile with optimistic
  concurrency and an audit trail.
- Public production checks on 2026-08-25 showed working profile and discovery
  routes. Claimed and community profiles rendered media kits. An unclaimed
  profile rendered the existing edit-contribution entry point but no media
  contribution path.

### Verified gaps

- `convex/events.ts:createCommunityEvent` currently requires authentication but
  can attach and immediately publish an event under any published community.
- The original submitter retains update authority for a community-linked event
  even when that subject has no current community authority.
- Browser-authored slots and participant records are immediately confirmed.
  The existing draft/review vocabulary is not exposed as a coherent workflow.
- There is no general browser event audit trail for create, update, publish,
  unpublish, cancel, or slot replacement.
- The upcoming-event query begins at `startAt >= now`, so an event that is
  already underway can disappear from public discovery.
- The event editor uses an unstructured slot input rather than ordered rows
  with profile lookup and an explicit fallback label.
- `docs/backend/event-schema.md` still describes canonical-time-first public
  presentation, conflicting with the current viewer-local product rule.
- `convex/profileAssets:createUploadIntentForOwnedProfile` requires ownership
  and explicitly refuses unclaimed profiles. `convex/profiles.ts` documents
  that media was excluded because the contribution path lacked moderation.
- Completed owner uploads become active public assets. The asset table has
  provenance values such as `community_submitted`, but no private proposal and
  review lifecycle creates them.
- Public media-kit selection uses asset visibility and state, not the profile's
  field-visibility contract. A media-kit profile image or banner can therefore
  bypass the corresponding legacy avatar or banner privacy choice.
- `about`, timezone, and genres are projected but not presented consistently.
  `searchAliases` and moderation internals must remain non-public.

### Live deployment boundary

Public media-kit rendering is verified. Private Vercel and Convex environment
values, direct-upload enablement, and accessibility-generation enablement are
`UNKNOWN` because the investigation did not use privileged environment reads
or mutate production. Implementation must verify these surfaces before rollout
without treating public rendering alone as proof of write readiness.

## Scope

### In scope

- authorization-safe community event drafting and publication
- ordered event slots with linked person profiles or safe display-label
  fallbacks
- ongoing and upcoming event discovery with bounded slot previews
- viewer-local public time presentation
- event cancellation, suppression, and audit behavior
- an explicit public-profile field and media visibility contract
- private media proposals for public unclaimed profiles
- source and credit context, moderation review, approval, rejection, withdrawal,
  retention, and claim transition
- owner and moderator visibility into appropriate contribution history
- documentation, rollout, observability, API-contract consistency, security
  tests, browser tests, and visual verification

### Out of scope

- RSVP, attendance, popularity, follows, recommendations, or presence inference
- recurrence authoring or automatic publication from calendar, poster, Discord,
  or model extraction
- full booking, performer negotiation, or mandatory performer accounts
- public event submissions on behalf of an unclaimed community
- hosted DJ sets, arbitrary audio/video uploads, or restream-derived recordings
- galleries, featured media, and banners as ordinary unclaimed-profile
  contribution targets in the first release
- broad trust scores, public reviewer identity, public moderation notes, or a
  social activity feed
- public API or MCP upload submission in the first release; browser submission
  is the bounded write path, while public reads remain contract-consistent

## Roles And Authorization

| Actor | Events | Unclaimed fields | Media proposals | Published media | Moderation data |
| --- | --- | --- | --- | --- | --- |
| Anonymous visitor | Read published | Read visible | None | Read visible approved | None |
| Authenticated contributor | None unless authorized | Existing bounded edits | Submit, view own, withdraw | None | Own disposition only |
| Claimed profile owner | Only with community authority | Edit owned profile | Review inherited pending items | Manage owned assets | Owner-appropriate history |
| Community owner or `manage_events` | Draft, edit, publish, cancel, slots | No extra person authority | No extra person authority | No extra person authority | Managed event audit |
| `manage_event_media` staff | Media-control only | None | None | None | Event-media audit |
| Super administrator | Suppress/unpublish, inspect | Moderator correction | Review and decide | Remove or suppress | Full authorized evidence |

Locked decision:

- A community event derives authority from current community ownership or
  `manage_events`, not from the original submitter.
- `manage_event_media` does not imply schedule or roster authority.
- Ordinary contributors cannot approve their own media.
- Community staff authority does not spill into unrelated person profiles.

Current recommendation:

- Use existing `super_admin` authority for first-release unclaimed-media
  review. Add a narrower moderator or trusted-partner grant only after real
  review volume proves it necessary.
- A profile owner who claims the target may decide still-pending proposals, but
  claiming alone never approves or publishes anything.

## Event Model

### Reused contracts

Keep `events`, `eventSlots`, `eventParticipants`, and `eventWorlds` as the
canonical records. Continue to store:

- UTC instants for event and slot boundaries
- one IANA event timezone for authoring, import, and export
- optional linked published community, world, and person profiles
- a display label when a person profile does not exist or should not be linked
- source type, label, URL, and review or confirmation state
- `eventStartAt`, `eventEndAt`, `eventPublicationState`, and `eventStatus` on
  world and participant associations so public profile/world queries can use
  bounded eligibility indexes; event writes keep these projections in sync,
  and current and future candidates are queried separately before applying the
  compact section limit

### Additions and corrections

Current recommendation:

- Add required `eventStatus: "scheduled" | "cancelled"` and write it from every
  event constructor. There is no missing-value compatibility state.
- Add `eventAuditEvents` for create, update, slot replacement, publish,
  unpublish, cancel, restore, and moderator suppression. Store actor, source,
  action, changed field names, reason where appropriate, and timestamp without
  copying private notes into public projections.
- Reuse `publicationState` for draft, published, and archived behavior rather
  than adding a second publication workflow.
- Make browser creation produce a draft owned by the linked community. An
  explicit publish action revalidates authority and every linked entity.
- Remove submitter-only update authority from community-linked records.
- Manual slots saved by an authorized organizer may be confirmed explicitly.
  Imported or extracted candidates remain draft until reviewed.
- A cancelled published event remains available at its direct URL with a terse
  cancelled state and exports `STATUS:CANCELLED`, but is excluded from upcoming
  discovery and profile event lists. Unpublishing or moderator suppression
  removes public access entirely.

### DJ and profile linkage

- The editor searches published person profiles and stores the exact
  `personProfileId` when selected.
- An unclaimed but publicly surfaced person profile can be linked. The event
  association is factual schedule data and does not transfer profile ownership.
- A freeform display label remains available so a missing profile does not
  block publishing.
- If a linked profile is later suppressed or made non-public, the slot keeps a
  safe display label but loses the profile link and private fields.
- `confirmed` means the event organizer or reviewed source confirms the
  schedule. It must not imply performer identity verification, endorsement, or
  inferred attendance.

### Discovery contract

- Keep direct lookup at `/` and event-oriented discovery at `/discovery`.
- Replace the generic event rail with a bounded time-oriented schedule using
  the shared `EventSchedule` primitive.
- Query a defined UTC window and include events already underway when their
  effective end is after `now`.
- Extend public previews with at most three relevant confirmed slots, each
  carrying time, display label, optional linked profile summary, and role.
- Show current events first by soonest effective end, then future events by
  start time. Current-event reads on discovery, person and community profiles,
  and active world surfaces inspect the 128 most recently started published events; if
  measured volume can hide a valid multi-day event, replace that explicit
  ceiling with indexed active-event state. Do not add popularity, attendance,
  recommendation, or hidden-personalization claims.
- Render cards, pages, profile associations, and slots in the viewer's local
  timezone. Show event timezone only in authoring or debugging context.

## Media Proposal Model

### Source-of-truth boundary

Locked decision:

- A proposed upload is not a `profileAssets` row and is never reachable through
  public asset routes.
- Approval creates a normal `profileAssets` row with
  `source: "community_submitted"`; rejection never creates one.
- Claiming does not rewrite provenance from community-submitted to
  owner-authored.

Add a private `profileMediaSubmissions` table with:

- `profileId`
- submission-time public profile slug and display name
- immutable submitter subject and user ID
- candidate upload/source references and content hash
- requested placement
- MIME type, byte size, dimensions, original filename, and private storage keys
- label, alt text, credit, and credit URL
- exact source URL or evidence reference
- optional contributor note
- status: `upload_pending`, `submitted`, `under_review`, `approved`, `rejected`,
  `withdrawn`, or `superseded`
- target profile version at submission and decision
- reviewer actor, review timestamp, public disposition, and private reason
- created, updated, expiry, and blob-cleanup timestamps

Indexes should support bounded queries by profile and status, submitter and
status, status and creation time, and content hash.

The submission-time profile name is the contributor-safe fallback if the target
is later hidden and privately renamed. There is no compatibility or backfill
path because this table has no deployed rows.

### Upload lifecycle

Reuse existing media processing and storage, but make upload intent purpose
explicit:

- `owner_publish` targets an owned profile and preserves current behavior.
- `community_proposal` targets a private submission and can never complete into
  a public asset by itself.

The schema and handlers enforce the discriminated target. The flow is:

1. Verify an active signed-in user and verified email.
2. Verify the target profile is published, publicly surfaced, and unclaimed.
3. Enforce per-user and per-profile pending limits and content-hash dedupe.
4. Create an `upload_pending` submission and purpose-bound upload intent.
5. Run the existing source-import or direct-upload quarantine pipeline.
6. Move the submission to `submitted` only after safe processing succeeds.
7. Let the contributor view its status or withdraw before a decision.
8. Let an authorized reviewer inspect the candidate, source, credit, and note privately.
9. Revalidate target state, claim state, profile version, quota, duplication,
   visibility, and placement conflict in the approval transaction.
10. Create the active asset, placement, audit records, and disposition
    atomically.

Current recommendation:

- First-release targets are `profile_image` for people and `primary_logo` for
  communities. Banner, additional logo, gallery, and featured placement remain
  owner-only until review volume and moderation patterns are proven.
- Allow one file per proposal, at most three pending proposals per user and two
  per profile, while retaining existing file-size and active-asset limits.
- Delete candidate blobs 30 days after rejection, withdrawal, expiry, or
  supersession unless an abuse or legal hold is recorded. Retain metadata and
  decision audit without retaining the image indefinitely.
- Keep cleanup operator-driven in the first slice: a super-admin runs one
  bounded action from the review queue. Do not add a cron or worker for this
  low-volume path.

### Moderation and takedown

Locked decision:

- Do not add rights categories, likeness categories, evidence taxonomies, or an
  attestation checkbox. A checkbox does not stop a bad actor and would add
  ceremony without changing the moderation boundary.
- Keep the submission useful to a reviewer: uploader identity, source URL,
  credit, optional note, file hash, decision, and audit history remain durable.
- Route disputes and takedowns through existing support with profile, asset,
  and submission IDs. Moderators need an immediate suppress/remove action that
  preserves audit history.

## Public Profile Visibility Contract

Apply one contract across profile pages, lookup, discovery, event previews,
editing, media selection, and private review.

| Data | Public profile | Discovery/search | Contributor | Owner | Admin/moderator |
| --- | --- | --- | --- | --- | --- |
| Slug, display name, type, public trust/source label | Always while public | Always while surfaced | Read | Read/edit where allowed | Read/edit |
| Aliases, tags, genres, headline, bio, role/category fields | `public` or `unlisted` | Only `public` | Existing readable-field policy | Read/edit/visibility | Read/edit |
| Region | `public` or `unlisted` | Only `public` | Existing bounded rule | Read/edit/visibility | Read/edit |
| Exact timezone | When deliberately visible | Only `public` | Existing bounded rule | Read/edit/visibility | Read/edit |
| Pronouns | When deliberately supplied and visible | Only `public` | Existing bounded rule | Read/edit/visibility | Read/edit |
| Outbound links | When visible and safe | Only `public` | Existing bounded correction path | Read/edit/visibility | Read/edit |
| Owner-authored `about` and personalization | When owner publishes | Only as projected | No access | Read/edit | Read/edit |
| Approved avatar/banner | Obey avatar/banner visibility | Only corresponding `public` field | No direct mutation | Manage | Manage/suppress |
| Approved logo/gallery/media kit | Obey media-kit visibility | Only `public` media kit | No direct mutation | Manage | Manage/suppress |
| Pending/rejected media | Never | Never | Own submissions only | Target submissions after claim | Full review evidence |
| Search aliases, owner IDs, raw actors, private notes, storage keys | Never | Authorized internal lookup only | Never | Owner-appropriate history | Full authorized view |

Current recommendation:

- Add a `mediaKit` visibility key for primary logo, additional logo, gallery, and
  featured media.
- Make media-kit `profile_image` obey `avatarImageUrl` visibility and media-kit
  `banner` obey `bannerImageUrl` visibility so placement cannot bypass privacy.
- Preserve the existing profile-visibility default: a field with no explicit
  visibility override is public.
- For newly community-submitted profiles, explicitly default region to
  `unlisted` and exact timezone to `private`. Existing profiles keep the
  established missing-visibility behavior; this slice does not retrofit them.
- Keep `about` owner-authored. Resolve bio/about rendering drift rather than
  exposing two competing narrative fields.
- Keep `searchAliases`, ownership internals, raw submitter/reviewer identity,
  moderation reasons, quarantined content, and abuse controls non-public.

## Public And Operator UX

### Event operator

- The current editor becomes structured: event details followed by ordered
  slot rows with start, optional end, profile lookup, fallback display label,
  and role/style.
- Slot authoring uses event timezone. Public previews render viewer-local time.
- Draft, publish, cancel, and unpublish actions are explicit and authorized.
- Discord export is available only after publication, when the canonical event
  route is public.
  Cancellation and moderator suppression require a reason and confirmation.
  Reversible unpublish requires confirmation.

### Public discovery and event pages

- `/discovery` leads with a schedule answering what is happening now and soon.
- Rows show local time, event title, host, world when known, and a bounded set
  of upcoming DJ or role slots.
- Event pages retain the fuller program and link published profiles without
  turning trust state into badge noise.
- Watch surfaces appear only when existing watchability rules say actionable.

### Media contributor

- A public unclaimed profile exposes `Suggest an edit`; media contributions
  live inline on that edit page.
- The form accepts one image, requested use, source, credit, alt text, and an
  optional reviewer note.
- The contributor receives a private status view. The image is never implied
  to be public before approval.
- Validation errors are specific and recoverable. Rejection has a concise
  disposition without private moderator notes.

### Reviewer and claiming owner

- The queue is bounded and filterable by state and target. It shows submitter
  and prior-matching-proposal evidence on each loaded row without pretending a
  client-only filter covers unloaded pages. `Prior` means created before the
  submission being reviewed.
- Review shows current profile/asset, candidate preview, source and credit,
  profile changes since submission, and prior proposals.
- Approval chooses final placement and public metadata. Rejection requires a
  disposition.
- A new owner sees pending and previously approved community contributions but
  not confidential moderator notes or reporter identity.

### Public-copy approval inventory

BASIC reviewed the rendered-copy inventory for this slice. Public surfaces use
existing approved patterns or short utility labels except for the four exact
sentences approved below.

### Exact rendered copy

Locked decision: BASIC approved these substantive sentences on 2026-08-28:

- `Profile media review access is required.`
- `Profile changed after submission.`
- `You cannot review your own media contribution.`
- `You cannot decide your own media contribution.`

The remaining entries are short utility labels or existing approved patterns.

Public profile and contribution:

- `Media contributions`
- `Community submitted`

Contributor states and errors:

- `Upload pending`, `Submitted`, `Under review`, `Approved`, `Rejected`,
  `Withdrawn`, and `Superseded`

Rate limits use the generic `Submission failed` utility label. They do not get
custom public copy.

Review and ownership:

- `Media review` and `Start review`
- `Prior matching proposals`
- `Contributor-visible disposition`
- `Private review reason`
- `Suppression reason`, `Suppress media`, and `Clean due files`

Events:

- `Set times`
- `Select a community`
- `Add event` and `Loading events…`
- `Start offset`, `Duration`, `Person profile`, `Lineup name`, and `Role or style`
- `Cancel event`, `Restore event`, and `Cancellation reason`
- `Save changes`, `Save and publish`, `Save draft`, and `Unpublish and save draft`
- `Cancelled`
- `Change history` and `Loading history…`

## Single-PR Implementation Sequence

The branch stays one pull request, with these reviewable checkpoints:

1. **Baseline tests and contracts.** Add failing authorization, visibility, and
   proposal-isolation tests before changing behavior.
2. **Authorization and visibility foundation.** Fix event authority, add event
   audit/status support, add media visibility, and close the privacy bypass.
3. **Event vertical.** Add structured slot editing, publication/cancellation,
   ongoing-event queries, preview slots, and the discovery schedule.
4. **Media proposal vertical.** Add private submission storage, purpose-bound
   uploads, moderation, atomic approval, cleanup, and claim transition.
5. **Integrated public behavior.** Prove approved contributed media appears on
   profile, event slot, and discovery only when permitted; pending media never
   does.
6. **Docs, contracts, and operations.** Update backend, developer, deployment,
   self-hosting, API/OpenAPI reads, moderation, support, and env docs together.
7. **Full verification and review recycle.** Run layered tests, desktop/mobile
   screenshots, VLM review, security review, and exact-head PR feedback loops.

A partially complete checkpoint is not a shippable product claim.

## Likely Implementation Map

### Convex and contracts

- `convex/schema.ts`
- `convex/events.ts`
- `convex/_eventInputs.ts`
- `convex/_eventSlots.ts`
- `convex/_eventPublic.ts`
- community authority helpers used by event writes
- new `convex/_eventAudit.ts` or equivalent
- `convex/_profileFieldVisibility.ts`
- `convex/_profilePermissions.ts`
- `convex/_profilePublic.ts`
- `convex/_profileLookup.ts`
- `convex/profilePrivacy.ts`
- `convex/profileAssets.ts`
- `convex/_profileAssets.ts`
- new `convex/profileMediaSubmissions.ts`
- new `convex/_profileMediaSubmissions.ts`
- `convex/profiles.ts`, `convex/profileClaims.ts`, and `convex/seedAccess.ts`
- `packages/api-contracts/src/schemas.ts`
- generated OpenAPI JSON and YAML when public read shapes change

### Web

- `apps/web/src/app/events/event-editor-form.tsx`
- `apps/web/src/app/_components/event-public-page.tsx`
- `apps/web/src/app/_components/discovery-public-page.tsx`
- `apps/web/src/app/_components/viewer-local-event-times.tsx`
- `apps/web/src/components/ui/event-schedule.tsx`
- event edit, public, and ICS routes
- `apps/web/src/app/_components/profile-public-page.tsx`
- `apps/web/src/app/account/privacy/privacy-panel.tsx`
- current media-kit upload preparation and upload-intent routes
- a public unclaimed-profile submission route and form
- an authenticated contribution-status route
- an account-scoped super-admin review route

### Tests and docs

- existing event foundation, ownership, calendar-import, and Discord tests
- existing profile foundation and media-management tests
- new profile-media submission and claim-transition tests
- Playwright coverage for contributor, reviewer, owner, event editor, event
  page, profile, and discovery states
- visual baselines for desktop and mobile
- `docs/backend/event-schema.md`
- `docs/backend/profile-schema.md`
- `docs/backend/profile-access-and-claims.md`
- `docs/backend/community-submissions.md`
- `docs/backend/search-discovery.md`
- `docs/planning/homepage-discovery-direction.md`
- `docs/planning/profile-media-kit-launch.md`
- deployment and self-hosting media configuration docs

## Data And Rollout

### Data rollout

- There is no deployed event-status, event-association projection, or
  media-submission data to migrate. Production does contain older owner-upload
  intents without a purpose, so permit that field to be absent in storage while
  writing it explicitly from every current constructor. Do not add a backfill
  job or broader compatibility layer.
- Start event audit history at rollout. Do not fabricate historical actors.
- Add media-submission tables and indexes with no seed, import, or migration
  path. Existing owner-managed `profileAssets` are outside the submission queue.
- `mediaKit` uses the existing sparse profile-visibility contract: omitted keys
  mean public. Do not add a special fallback, backfill, or migration for it.
- Revalidate pending submissions against the current target profile version at
  decision time rather than assuming the snapshot is current.

### Feature enablement

Current recommendation:

- Add a checked-in `VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED=false` expectation
  for web and Convex, documented beside existing media-kit flags.
- Keep submission creation and review disabled until schema, storage lifecycle,
  reviewer access, cleanup, support routing, and integrated tests are ready.
- Do not add an undocumented dashboard-only switch. Document owner, scope,
  recreation, and rollback behavior.
- Event authorization fixes are not optional flags. Discovery may ship only
  when the corrected write path and public query deploy together.

### Rollback

- Disabling media submissions stops new proposals and decisions without hiding
  already approved assets. Candidate cleanup continues.
- Event rollback must not restore the authorization bug. If the discovery
  composition fails, fall back to the existing bounded preview while preserving
  corrected write authority.
- Moderator suppression and owner asset removal remain available throughout.

## Security, Privacy, Cost, And Operations

### Security and privacy

- All writes recheck current authority server-side.
- Approval is atomic and fail-closed on claim, suppression, publication,
  profile-version, placement, quota, and duplicate changes.
- Candidate routes require the submitter, target owner after claim, or an
  authorized reviewer. They never use public asset tokens.
- Preserve existing MIME, signature, size, SSRF, quarantine, processing-lease,
  and storage-key protections.
- Rate limits and abuse counters do not reveal private or suppressed profiles.
- Public projections never expose raw auth subjects, reviewer identities,
  internal notes, storage keys, or exact candidate filenames.

### Cost and self-hosting

- Event schedule reads are bounded by window, event count, and preview slots.
- Pending limits, one-file proposals, hash dedupe, and 30-day cleanup bound
  temporary storage and derivative-processing cost.
- Reuse current S3-compatible media infrastructure and Convex contracts. A
  self-hosted deployment may disable contributions while retaining owner media
  and event programming.
- No new paid provider is required. Accessibility generation remains behind its
  existing separate flag and is not required for contribution review.

### Observability and operator workflow

- Record counts and latency for submission creation, processing failures,
  review age, decisions, cleanup, event publication failures, and discovery.
- Keep stuck processing, overdue cleanup, and failed decisions visible in the
  bounded review/operator surfaces before introducing alerting infrastructure.
- Logs use IDs and error classes, not image URLs, filenames, captions, private
  notes, or auth tokens.
- The review queue makes stale profile versions, duplicate assets, source URLs,
  and contributor credit visible before approval.

## Test And Verification Strategy

### Backend and authorization

- unrelated users cannot create, publish, update, cancel, or attach an event to
  a community
- owner and current `manage_events` staff can act; removed staff and an
  unauthorized original submitter cannot
- `manage_event_media` alone cannot edit schedule data
- draft, disputed, unconfirmed, suppressed, and archived data never leaks
- ongoing queries include in-progress events and exclude ended events
- slots preserve ordering, bounds, timezone, and safe fallback behavior
- contributor upload intents cannot become public assets without approval
- contributors cannot review their own or read others' proposals
- approval rechecks claim, profile state, version, quota, hash, and placement
- claim preserves pending and approved provenance without auto-publication
- opted-out, suppressed, archived, draft, or private targets fail closed
- rejected, withdrawn, expired, and superseded blobs become cleanup-eligible
- media-kit avatar, banner, logo, and gallery projections obey profile privacy

### Contract and integration

- public web, Convex, REST, OpenAPI, and MCP read shapes remain aligned
- ICS carries UTC instants and correct cancellation state
- event/profile links safely fall back when a profile is hidden
- an approved contributed asset appears on profile and event surfaces only when
  asset and profile visibility permit it
- no public endpoint can fetch a pending candidate by guessing an ID or path

### Browser and visual

- event draft, slot editing, publish, cancel, and permission-denied flows
- discovery with no events, one current event, overlap, long names, missing
  images, and mixed linked/unlinked slots
- media upload, processing, pending, rejection, approval, withdrawal, stale
  profile, and claim-transition flows
- reviewer comparison and owner privacy controls
- desktop and mobile screenshots at realistic density
- VLM review for hierarchy, scanability, overflow, empty/error states, calm
  visual language, and accidental badge/copy noise
- BASIC approval of every substantive public string in rendered context

## Acceptance Checklist

- [ ] A user without current community authority cannot publish or edit a
      community event.
- [ ] An owner or `manage_events` staff member can draft, publish, edit, cancel,
      and audit an event with ordered DJ or role slots.
- [ ] A slot can link an exact published profile or keep a safe label.
- [ ] `/discovery` includes current and upcoming events with bounded relevant
      slots and viewer-local times.
- [ ] Event pages, profiles, discovery, and slots use consistent viewer-local
      presentation across DST boundaries.
- [ ] A verified contributor can propose one allowed image for a public
      unclaimed profile.
- [ ] The proposal, candidate, reviewer identity, and private evidence are never
      public before approval or after rejection.
- [ ] The contributor cannot approve their own proposal.
- [ ] An authorized reviewer can decide with durable provenance and audit.
- [ ] Approval atomically creates a `community_submitted` asset only after all
      current checks pass.
- [ ] Claiming does not auto-publish pending media and gives the owner intended
      review and removal controls.
- [ ] Avatar, banner, logo, and media-kit assets cannot bypass profile privacy.
- [ ] Rejected and abandoned candidate blobs expire under documented policy.
- [ ] Support can suppress a disputed asset without erasing audit history.
- [ ] Backend, contract, browser, security, accessibility, and policy checks are
      green for the exact head.
- [ ] Desktop and mobile screenshots have been visually reviewed.
- [x] BASIC has approved the exact new public copy.
- [ ] Docs and checked-in environment expectations match implementation.
- [ ] The PR completes the post-push review window and final exact-head feedback
      refresh before being called merge-ready.

## Decisions BASIC Must Make

These may be made while implementation proceeds, but dependent behavior cannot
be publishable until they are locked.

1. **Initial placements.** Current recommendation: person profile image and
   community primary logo only.
2. **New-profile visibility defaults.** Current recommendation: region
   unlisted, exact timezone private, deliberately supplied pronouns public,
   approved avatar/logo public, gallery owner-controlled.
3. **Review authority.** Current recommendation: `super_admin` plus the owner
   after claim; defer trusted-partner approval grants.
4. **Lineup semantics.** Current recommendation: authorized organizers
   may publish an announced lineup from their source without separate performer
   approval; confirmation describes the schedule source, not endorsement.
5. **Cancellation presentation.** Current recommendation: keep a published
   direct page and cancelled ICS, but remove the event from upcoming discovery
   and profile lists.

Locked decisions:

- Community submission uses moderation and audit, without rights/likeness
  categories or an attestation checkbox.
- Rejected, withdrawn, expired, and superseded candidate files are deleted
  after 30 days unless held for an abuse or legal matter.
- New event-status and media-submission data starts clean. New upload intents
  always write a purpose, while older owner-upload rows may omit it;
  absent purpose is treated as owner upload, with no backfill job or broader
  compatibility layer.

## Research Disposition

| Question | Disposition | Confidence |
| --- | --- | --- |
| Can current event/profile/asset foundations support the slice? | Reuse them | High, code verified |
| Can contributors currently attach unclaimed-profile media? | No; ownership checks prevent it | High, code and live UX verified |
| Is public media rendering deployed? | Yes | High, public live check |
| Are live upload/accessibility flags enabled? | `UNKNOWN`; verify before rollout | Deliberate unknown |
| Does browser event creation enforce community authority? | No; API owner paths are stricter | High, code verified |
| Should proposals reuse `profileAssets` state? | No; use private staging | High recommendation |
| Should submissions collect rights/likeness claims? | No; moderate the submission itself | Locked by BASIC |
| Is a broader moderator role needed? | Not initially if `super_admin` volume is manageable | Validate after usage |

## PR Framing

One PR should tell one integrated story:

> Authorized community operators can publish useful event schedules with linked
> people, while contributors can safely propose reviewed media for unclaimed
> profiles under one enforceable public-visibility contract.

Do not call the PR merge-ready merely because one checkpoint is green. The
latest commit must be pushed, the required waiting window must elapse, and every
exact-head check, comment, review thread, formal review, and mutable AI-review
summary must be refreshed and settled before the final readiness claim.
