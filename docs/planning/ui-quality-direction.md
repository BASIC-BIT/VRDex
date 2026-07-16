# UI Quality And Product Surface Direction

## Status

Current recommendation from the July 15, 2026 product review and three parallel
design explorations.

This document turns the current visual and UX review into a shippable cross-app
quality epic. It complements `docs/planning/homepage-discovery-direction.md`
and `docs/engineering/design-system.md`; it does not replace either source.

## Goal

Make the first public and account surfaces feel like a deliberate VRChat scene
utility and identity directory rather than an AI-generated dashboard or an
engineering demo.

The work should remove unnecessary words and containers before adding visual
decoration. Strong identity media, typography, schedules, live context, and
direct actions should carry the product.

## Review Inputs

Observed user feedback:

- Public pages use too many bordered surfaces, large headings, eyebrow labels,
  badges, and explanatory paragraphs.
- Several pages explain implementation mechanics instead of helping the user
  complete a task.
- Profile identity, aliases, trust, links, and streaming controls are spread
  across redundant sections.
- Home uses profile media in the wrong form factor and gives marketing copy
  more emphasis than useful discovery data.
- Auth, account, claim, submission, and event-authoring routes expose raw
  system capabilities instead of contextual flows.
- Lookup owns a one-off text theme toggle and exposes the browser broken-image
  state when profile media is missing.
- The current server-status route is a development read-path demonstration,
  not a status product.

Verified implementation facts:

- Profile `headline`, `bio`, `about`, person `roleTags`, and shared `tags` are
  distinct fields. The public hero renders `headline` with `bio` as fallback,
  while the separate Focus card unions `roleTags` and `tags`. The current UI
  can therefore repeat related content even when the records are distinct.
- Public profile About currently concatenates both `bio` and `about`, then adds
  the redundant labels `About` and `Public identity`.
- VRCDN playback already has three derived variants: browser HLS, Quest
  MPEG-TS at `.live.ts`, and PC `rtspt://`. RTMP is an ingest concern and is
  not the public desktop playback link represented by the current model.
- Lookup owns route-specific light and dark tokens and a text-only toggle. The
  rest of the application does not share that theme state.
- The existing public-route test contract still expects explanatory signed-out
  pages for submission, event creation, and account routes.
- Twitch `Get Streams` can provide live state, title, viewer count, and start
  time using an app or user access token. Live UI still needs a freshness and
  failure policy before it is trustworthy.

## Product Principles

Locked decision:

- User-facing copy must describe the user's task or the data in front of them,
  not adapters, mutations, provenance plumbing, rollout state, or future
  architecture.
- Public profiles are owner-centered identity pages. Test data, slugs, trust
  essays, and implementation caveats do not occupy primary space.
- Layout hierarchy and whitespace come before cards. A card is used only when
  a repeated item, tool, form, or bounded status object needs a frame.
- Missing media has an intentional fallback. The browser broken-image icon is
  never a supported state.
- Theme selection belongs to the global shell and uses an icon control with an
  accessible label. It is not a lookup-only text switch.
- Unauthenticated protected routes preserve the intended destination through
  sign-in and redirect instead of rendering a large explanatory dead end.

Current recommendation:

- Treat VRDex visually as an editorial scene directory and live utility. Use
  stronger type, imagery, schedules, and direct controls rather than gradients,
  decorative pills, or nested panels.
- Keep corners subtle and mostly square. Reserve compact badges for genuine
  state such as verified identity or live status.
- Let person, event, community, and world media keep stable, purpose-specific
  aspect ratios. Do not stretch a square profile image into a landscape feature.
- Explore a restrained index, Rolodex, or scene-catalog motif through navigation
  and motion later. Do not make a literal novelty illustration the product shell.

Candidate direction:

- The blind concept's high-contrast editorial composition is a useful taste
  reference for profile and live-event hierarchy. Its exact brutalist styling
  is not yet a production theme decision.
- A warm light theme can make VRDex feel less like a generic developer tool,
  but only after the same information architecture works in the existing
  charcoal token mapping.

## Surface Direction

### Global Shell

- Home shows `Sign in` when anonymous.
- Signed-in state shows one account control with the best available profile or
  provider image and a text fallback.
- Search, theme, and account controls are globally consistent.
- Icon-only controls use familiar icons, tooltips, stable dimensions, and
  accessible names.

### Public Person Profile

- Keep avatar, name, compact verification, `aka` aliases, and one headline in
  a single identity composition.
- Remove the separate Status and Focus cards.
- Keep structured roles only when they add information beyond the headline;
  render them near identity or as compact metadata, not as decorative tags.
- Use one About heading and one owner-authored prose body. Resolve the long-term
  distinction between `bio` and `about` before exposing both editors.
- Present Discord usernames as copyable text. A Discord user is not modeled as
  an outbound URL.
- Use direct actions for valid outbound services rather than equal-weight link
  tiles.
- Put `Claim this profile` on an unclaimed person's page. Use `Propose an edit`
  for community-submitted changes that are not ownership claims.
- Show verified state inline. Dense lookup may remain icon-only; the larger
  profile header can use icon plus `Verified`.

### Streaming

- Combine Twitch and VRCDN into one streaming tool when either exists.
- Twitch gets a normal watch action. `Live now` appears only with a fresh
  provider result and may include the current title.
- VRCDN browser playback should use the supported watch surface rather than
  sending users to a raw stream URL.
- Quest MPEG-TS and PC RTSPT values are copy rows with monospace text.
- Never expose RTMP ingest URLs, stream keys, secret references, or provider
  health internals on a public profile.
- Profile owners need an explicit visibility choice before technical playback
  URLs are assumed public.

### Home And Discovery

- Remove the oversized marketing headline and descriptive paragraph.
- Keep direct search available, then lead with useful current and upcoming
  scene activity.
- Featured placements use explicit media roles and stable crop behavior.
- A square person image remains square or portrait. A landscape feature uses a
  banner, event poster crop, or composed layout rather than an arbitrary zoom.
- Discovery ranking and richer modules remain part of the separate Home and
  Discovery direction; this epic fixes hierarchy and presentation first.

### Lookup

- Add a deliberate image fallback with initials or a neutral media treatment.
- Adopt the global theme and account controls.
- Keep lookup dense and operator-focused. Do not import profile-page biography
  or decorative status surfaces into result rows.
- Preserve existing VRCDN copy behavior while aligning labels and visual
  treatment with the public streaming tool.

### Sign In

- Stack Discord and Google as full-width provider actions.
- Put email/password behind a quiet `Use email and password` disclosure.
- Preserve the useful labeled-divider pattern with neutral copy such as `or`.
- Keep account creation available after disclosure without making every auth
  mode compete at first glance.

### Account And Claims

- Replace the giant claim-readiness headline with a compact account heading.
- Rename or restructure `Linked providers` around recognizable sign-in methods.
- Keep account identity, email state, sign-in methods, privacy, appearance, and
  sign-out direct and scannable.
- Do not expose person claim, community claim, and VRChat proof code as three
  parallel raw forms.
- Start claims contextually from a public profile and optionally surface one
  confident likely match in Account.
- Move community ownership and administration into community context.
- Use a stepped flow only when a claim actually requires multiple user
  decisions. Do not add a wizard shell around a single action.

### Submission And Proposed Edits

- Initial profile submission asks only for fields needed to recognize and find
  the person or community.
- Remove media-kit management from initial submission.
- Frame edits to unclaimed profiles as proposed changes. The first version may
  apply low-risk changes directly behind the scenes, but the contract must
  leave room for later review and attribution.
- Keep profile creation, ownership claim, profile editing, media-kit management,
  and event publishing as distinct contextual jobs.

### Event Authoring

- Anonymous `/events/new` and event edit routes redirect to sign-in with a
  return destination.
- Authenticated event editors show the form, not a paragraph about mutations
  or enabled adapters.

### Server Status

Current recommendation:

- Remove `/server-status` and any primary navigation to it now.
- When VRDex operates real external monitors, use a status system deployed
  independently from the application it measures.
- Kener is a credible self-hosted option with heartbeat, HTTP, TCP, DNS, SSL,
  incident, maintenance, and history support. OpenStatus is a credible
  open-source monitoring-as-code option. Atlassian Statuspage and Better Stack
  are credible hosted comparisons.
- Do not build a custom heartbeat UI before monitor ownership, incident
  communication, and independent hosting are defined.

## Design Explorations

Three standalone HTML concepts were commissioned for this pass:

1. Blind editorial concept: no repository or screenshot context; tests whether
   an independent designer converges on a stronger identity and live-scene
   composition.
2. Critique-led concept: translates the screenshot review into concrete profile,
   home, auth, account, submission, and proposed-edit states.
3. System-native concept: uses the current semantic tokens and primitives and
   identifies a practical migration path.

The local comparison artifacts live under `.tmp/design-explorations/` during
the review. They are evidence, not production code or a new source of truth.

## Delivery Epic

Current recommendation: execute this as one UI quality epic with a small number
of coherent, locally integrated pull requests.

### Slice 1: Shell And Guardrails

- global navigation auth state
- global icon theme control and shared persistence
- protected-route return-to redirects
- missing-image primitive and stable media dimensions
- updated visual contracts for desktop and mobile

### Slice 2: Public Identity And Streaming

- public person profile information hierarchy
- compact trust and aliases
- link actions and Discord copy behavior
- combined Twitch and VRCDN streaming tool
- contextual claim and proposed-edit entry points

### Slice 3: Account, Auth, And Claims

- progressive sign-in composition
- concise account surface
- contextual person claim flow
- community administration removed from generic account context
- useful no-owned-profile path into claim/search

### Slice 4: Submission And Editing

- narrow initial submission
- no media kit in first creation
- proposed-edit framing and minimal evidence/source capture
- authenticated edit routing

### Slice 5: Home And Lookup Presentation

- terse Home hierarchy aligned with the separate discovery plan
- stable featured media behavior
- lookup media fallback and global shell adoption
- removal of leftover route-specific explanatory copy

### Slice 6: Status And Cleanup

- remove development-only server-status and deployment surfaces from public
  navigation
- audit public routes for obsolete demo/test copy
- document the later independent status-system decision gate

Each slice should be implemented and visually verified locally before one
intentional push. CI path filtering can be considered separately; this epic
should not add complicated workflow conditions merely to compensate for small,
successive commits.

## Acceptance Criteria

- Public surfaces no longer expose implementation notes or demo-state prose.
- No public route shows the browser broken-image icon.
- Global navigation shows correct anonymous and signed-in account state.
- Theme control is global, icon-based, accessible, and stable across routes.
- Profile identity, aliases, trust, roles, and about content do not repeat.
- Discord usernames copy; valid external links navigate.
- Twitch and VRCDN controls use correct public playback semantics.
- Anonymous protected routes preserve and resume the requested task after sign-in.
- Claims start from person context instead of three generic account forms.
- Initial submission excludes media-kit administration.
- Home uses useful data before explanatory product copy and respects media form
  factors.
- Desktop and mobile Playwright screenshots receive explicit visual review.
- Existing semantic tokens and primitives remain the implementation contract.

## Open Questions

1. Should `bio` and `about` remain separate authored fields, or should one be
   deprecated in favor of a single profile prose field?
2. Are Quest MPEG-TS and PC RTSPT links public by default, owner-controlled, or
   limited to the operator-focused lookup surface?
3. Should Twitch live state ship in the profile slice using app-token polling,
   or should the UI reserve the state until provider caching is designed?
4. When a person has several aliases, how many remain inline beneath the name
   before the list collapses?
5. Which source wins for the signed-in account image: owned VRDex profile,
   auth-provider avatar, or a deterministic fallback?
6. Which proposed edits are low-risk enough to apply immediately before a
   durable review queue exists?

## References

- [Mobbin reference library and agent access](https://docs.mobbin.com/)
- [Twitch API: Get Streams](https://dev.twitch.tv/docs/api/reference#get-streams)
- [Kener](https://github.com/rajnandan1/kener)
- [OpenStatus](https://www.openstatus.dev/)
- [Atlassian Statuspage](https://www.atlassian.com/software/statuspage/features)
- [Better Stack](https://betterstack.com/docs/getting-started/welcome/)

