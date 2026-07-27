# Jobs To Be Done And Product Journeys

## Status

Current recommendation for near-term product prioritization and journey design.

This document is intentionally separate from
`docs/planning/personas.md`. A job to be done is a concrete goal in a session.
It is not a stable identity, role, persona, or demographic segment.

## Prioritized Jobs

### J1. Find a known person or community and judge the result

When I already know who I need, help me find the canonical record, useful
links, and trust context quickly so I can act without searching across Discord
and link pages.

Current recommended journey:

1. Enter an exact name, alias, or handle.
2. See one canonical person or community result with a useful sparse fallback.
3. Show claim/control verification, fact provenance, freshness, and public
   surfacing as separate dimensions.
4. Open the canonical profile or a contextual claim path.

Primary surfaces: Search, DJ view, public profiles, Claim.

### J2. Assemble a reusable lineup or identity packet

When I am coordinating a lineup, booking, promotion, or event, help me combine
canonical links, genres, and logos with event-scoped stream and schedule facts
without re-entering the same data or storing temporary event facts on a
profile.

Current recommended journey:

1. Paste or search one or more names.
2. Resolve canonical profiles and flag uncertain or missing matches.
3. In DJ view, foreground public genres and music, stream, and contact links
   without changing identity semantics. `DJ` describes the profiles shown; it
   does not classify the person using the view.
4. Join public, reusable profile assets and links with the current event or
   slot facts in an export packet.
5. Preserve missing and imported provenance instead of filling gaps.

Primary surfaces: DJ view, bulk lookup, Media Kit, event slots and exports.

### J3. Claim, correct, and control a representation

When a profile represents me or my community, help me prove appropriate
control, review what came from others, and decide what is public.

Current recommended journey:

1. Start from the exact profile rather than choosing person/community again.
2. Sign in and verify email.
3. Use a verification method appropriate to a person or community.
4. Resolve success, pending, conflict, recovery, correction, or opt-out.
5. Continue to profile editing, visibility, or media-kit management.

Primary surfaces: Claim, handoff, Account, profile editor, privacy controls.

Community claimant eligibility, authority evidence, conflicts, recovery, and
singleton-owner precedence remain claim-domain rules. Staff tags alone never
grant claim authority.

### J4. Publish and maintain a canonical person or community page

When I own a profile, help me keep a trustworthy, expressive page that other
people and workflows can reuse.

Current recommended journey:

1. Confirm identity facts, role descriptions, links, and source state.
2. Add or manage public media with accessible descriptions.
3. Choose field visibility and public surfacing.
4. Preview public presentation and compact search/event presentation.
5. Update facts as roles, links, or staff change.

Primary surfaces: onboarding, Account, profile editing, Media Kit, public
profile.

### J5. Publish or coordinate an event and its contributions

When I operate an event, help me connect a community, world, schedule, people,
and contribution slots so the same facts can power public pages and exports.

Current recommended journey:

1. Create, import, or review an event.
2. Associate broad participants separately from timed contribution slots.
3. Record a scoped role, confirmation state, and source for each slot.
4. Reuse canonical profiles, links, and media.
5. Publish event, Discord, calendar, and watch outputs as appropriate.

Primary surfaces: community and event tools, slots, Discord/calendar exports,
public event pages.

### J6. Discover what is happening now or soon

When I do not have a specific name, help me understand what is happening in my
local time and move from an event to its people, community, world, or watch
path.

Current limitation:

- The direction is established, but content density and ranking evidence are
  not yet strong enough to make broad discovery the root experience.

Primary surfaces: `/discovery`, event schedule, event/community/world pages.

### J7. Submit or correct somebody else's record safely

When I have public facts I am allowed to share, help me submit or stage them
without presenting them as owner-confirmed.

Current recommended journey:

1. Authenticate and select a person or community record.
2. Submit only allowed public fields from a source whose use VRDex is
   authorized to review.
3. Review and match against existing, opted-out, or suppressed identities.
4. Keep imported candidates private until explicit review permits publication.
5. Provide claim, correction, merge, and opt-out paths.

Primary surfaces: community submission, reviewed imports, concierge handoff,
moderation.

The detailed safety contract remains in
`docs/planning/seed-import-model.md`: prohibited private contacts, raw provider
identifiers, private notes, and unreviewed assertions never become public.
Internal review evidence, public source category, submitter identity, and the
owner-visible audit trail require separate visibility rules. Publication also
needs bounded writes, duplicate/impersonation checks, reporting, appeal, and
emergency suppression.

### J8. Stop a harmful or unauthorized representation

When a record, asset, association, or public fact is invasive, false, or
unauthorized, help me report it and get urgent harm contained without forcing
me to prove ownership first.

Current recommended journey:

1. Report from the affected surface or a direct support entry.
2. Identify the exact record, field, asset, or association without collecting
   more sensitive data than the report requires.
3. Apply emergency suppression when the risk threshold is met.
4. Show bounded status and a path to add evidence, appeal, or resolve a
   dispute.
5. Preserve private audit evidence while keeping the harmful fact out of public
   surfaces and exports.

Primary surfaces: report/correction entry, moderation, suppression, claim and
ownership disputes.

This is a safety-critical journey, not evidence that harm reports are a common
market segment.

## Cross-Persona Journey Matrix

Personas are defined in `docs/planning/personas.md`.

The cells below are unvalidated review prompts, not audience assignments or
feature priorities.

| Job | Utility-first user | Representation-conscious user | Privacy-conscious user | Evidence-sensitive user |
| --- | --- | --- | --- | --- |
| J1 direct lookup | Speed and density | Sees how identity renders | Requires suppression everywhere | Provenance and confidence |
| J2 reusable packet | No re-entry | Supplies approved assets | Controls public contact/media | Needs current, attributable facts |
| J3 claim/control | Wants low ceremony | Needs meaningful ownership | Needs correction and opt-out | Needs honest verification meaning |
| J4 maintain page | Values reusable output | Wants voice and polish | Visibility and deletion | Reads owner-confirmed state |
| J5 coordinate event | Structured reuse | Controls contribution display | No inferred attendance | Scoped role/source facts |
| J6 discover soon | Wants local-time utility | Wants contextual exposure | Rejects creepy personalization | Needs honest ranking labels |
| J7 seed/correct | Efficient reviewed input | Must retain final authority | Faces risk from bad submissions | Uses source/review labels |
| J8 stop harm | Direct bounded reporting | Representation can be corrected | Urgent containment without ownership | Sees clear disposition |

## Concept Boundaries

| Concept | Product treatment | Must not become |
| --- | --- | --- |
| Human or community identity | First-class `person` or `community` profile, independent of the account that may claim it | Persona, role, or account type |
| Research persona | Internal behavioral/taste hypothesis | Public segment, filter, analytics property, or feature requirement |
| Session intent / JTBD | Route, entry point, workflow, or typed preset | Permanent user classification |
| Person role | Owner-authored and visibility-controlled dynamic `person_role` vocabulary such as DJ, VJ, performer, organizer, photographer, or world creator | Verified credential, permission, or availability claim |
| Community category/subtype | Dynamic vocabulary such as venue, collective, promoter, or agency | Giant hard-coded taxonomy |
| Community staff role | Small role/capability authorization model with singleton owner | Public identity tag |
| Event participant association | Broad scoped connection between an entity and event; role and time are not required | Attendance or performance claim |
| Event contribution slot | Scoped record with role, time, source, and confirmation | Permanent profile role |
| Genre or self-expression tag | Dynamic public vocabulary with provenance and visibility | Eligibility fact |
| Availability or bookability | Remain out of schema until a real workflow defines owner, scope, validity window, visibility, and stale-state behavior | Inference from role, links, or recent events |
| Verification | Identity/control and provenance state; potentially field-level later | Blanket proof that every profile fact or role is true |
| Presentation view | Built-in display or search view over the same canonical records | Duplicate data model or separate product silo |

Locked decision:

- A person can hold several roles, change roles, stop offering a service, join
  community staff, or attend an event without changing identity.
- `DJ`, `VJ`, `performer`, `organizer`, `venue`, `promoter`, `photographer`,
  `world creator`, `staff`, and `attendee` must not all share one field:
  some describe people, some communities, some permissions, and some scoped
  event participation.
- Self-attestation and reviewed/imported provenance may be useful public facts,
  but neither is role verification.

## Surface Implications

### Search And DJ Links

Current recommendation:

- Use one search architecture with typed, closed state.
- Ship two built-in presentation views: `standard` and `dj`.
- Keep `view=dj` person-only and foreground visible genres plus music, stream,
  and contact links, but do not make a DJ role tag an index-enforced
  eligibility rule yet.
- Preserve exact-name matches and useful sparse/imported fallbacks.
- Show profile/source trust consistently across standard and DJ presentation.
- Keep bulk pasted lineups session-local; do not place them in public URLs or
  analytics.
- Do not add a public search DSL, user-authored view definitions, or a second
  DJ-specific result store.

### Claim

Current recommendation:

- Claim starts from a specific profile; the record already determines person
  versus community.
- Keep login, email verification, claim authority, identity verification, fact
  provenance, visibility, publication, suppression, and freshness separate.
- Search may provide a narrow contextual claim entry but must not own claim
  state or verification behavior.
- Sparse/imported profiles need claim, correction, dispute, merge, and opt-out
  paths before broad publication becomes a growth tactic.

### Media Kit

Current recommendation:

- People and communities share one media-asset system.
- Media supports J2 and J4: owner management, reusable public assets, ordering,
  featured presentation, downloads, and accessibility metadata.
- Compact search cards consume a stable identity/media projection rather than
  the whole gallery.
- Imported or community-provided assets retain provenance and never imply
  owner approval.
- Uploaders must assert authority to share an asset; source/right provenance,
  subject reporting, and takedown remain required even while full licensing
  workflow stays deferred.
- Do not expand into video/audio, bulk DAM, complex collaboration, licensing,
  or AI-authored metadata without a separate proven job.

### Onboarding And Profile Editing

Current recommendation:

- Organize entry and progress around a selected job, not a persona quiz.
- Do not ask users to select one permanent role during onboarding.
- Let owners describe several public roles and change them over time.
- Keep availability absent until there is a concrete owner-authored workflow.
- Treat profile completeness as contextual: a DJ packet, community page, or
  event contribution may require different fields.
- Do not invent explanatory prose to make an unfinished flow feel complete;
  follow the public-copy rule in `docs/planning/personas.md`.

### Trust, Abuse, And Spam

Current recommendation:

- Enforce suppression and field visibility before indexing, filtering,
  rendering, exporting, or associating profiles.
- Keep source and review state for imported, community-submitted, concierge,
  moderator, and owner-authored facts.
- Do not infer a role from outbound links, event names, posters, media, or
  group membership.
- Treat vocabulary spam and alias merging as moderation work before exposing
  arbitrary user-created terms as global filters.
- Treat impersonation, doxxing, harassment, malicious provenance, duplicate
  claims, and coordinated submissions as abuse cases, not taxonomy quality.
- Missing or stale data must remain missing or stale; do not synthesize a
  reassuring value.

### International And Accessibility

Current recommendation:

- Render event and slot times in the viewer's local timezone.
- Preserve Unicode names and reviewed aliases; do not silently translate,
  anglicize, or merge role/category terms.
- Do not offer language, region, or timezone filters until data is normalized,
  owner-controlled, sufficiently dense, and privacy-reviewed.
- Search, filter, claim, and media flows must remain keyboard and screen-reader
  usable; trust state cannot depend on color or iconography alone.
- Public media needs meaningful alternatives where the media conveys content.
- Short public copy still must be explicit enough for accessibility names and
  error recovery.
- Review zoom and reflow, focus order, reduced motion, touch targets,
  accessible live status/error announcements, locale formatting, daylight
  saving transitions, right-to-left layouts, and cross-language aliases before
  claiming international or accessibility readiness.

## Filter And Preset Recommendations

### Justified now

| Control | Recommendation | Reason |
| --- | --- | --- |
| Query | Ship | Direct lookup is the current root job |
| Entity type | Ship `all`, `person`, `community`, `world`, `event` in standard search | First-class schema distinction with backend filtering |
| Standard view | Ship | Generic identity/entity lookup |
| DJ view | Ship as a typed person presentation preset | Repo-evidenced operator job without claiming strict DJ eligibility |
| Trust/source presentation | Show and use cautiously in ranking; do not default to a filter | Users need context, while a filter could hide useful sparse records |
| Event time presets | Use on event/discovery surfaces when data exists | Serves now/soon discovery without becoming a profile identity facet |

### Justified after evidence

| Control | Evidence gate |
| --- | --- |
| Role filters such as DJ, VJ, photographer | Normalized aliases, provenance policy, abuse handling, sufficient public density, and an owner decision about inclusion semantics |
| Genre facets | Sufficient normalized public coverage and evidence that users narrow rather than merely read genres |
| Community subtype/category | Real distribution across non-club communities and reviewed vocabulary |
| Region/timezone | Normalized owner-authored data, privacy review, international semantics, and sufficient density |
| Availability/bookability | A concrete workflow defining scope, validity window, staleness, visibility, and owner authority |
| Language/locale | Localization strategy and owner-authored data; never inferred |
| Saved/personal views | Repeated behavior and a privacy model for saved intent |
| Stored declarative presets | At least three materially different proven built-in views or a real no-deploy moderation need |

### Not justified

- public or executable search DSL
- persona filters
- demographic or sensitive-attribute inference
- role inference from links, event history, or media
- attendance, private presence, or friend-context filters without explicit
  consent and a dedicated privacy review
- popularity, trending, or paid ranking without safe documented data and
  labeling policy

## Filter Decision Rule

A new public filter or preset may be proposed only when all of these are true:

1. A named current JTBD requires narrowing or presentation that ordinary query
   and entity type cannot provide.
2. The underlying field has sufficient public data density in the complete
   corpus, not only a fixture or first result page.
3. The field has defined owner, source, visibility, suppression, moderation,
   and stale-state semantics.
4. Multi-role people and people changing roles do not become misclassified.
5. The label works for international and accessible use without implying
   verification, eligibility, popularity, or availability.
6. The expected success signal and privacy-safe telemetry are defined.
7. The same goal cannot be met more safely by a presentation preset, contextual
   entry point, or result-card field.
8. A named decision owner records the measured corpus denominator, coverage and
   error thresholds, abuse sample, and evaluation window.

If any condition fails, keep the concept as display metadata, a dynamic tag, a
private operator tool, or an interview question rather than adding a filter.

## Analytics Implications

Repository evidence:

- Existing analytics are deliberately sparse and avoid raw search terms,
  profile slugs, private fields, and raw account identifiers.

Current recommendation:

- Do not assign persona labels to users in PostHog.
- Measure journeys and outcomes, not inferred identities.
- Preserve current search/claim event boundaries and add only events needed to
  answer a named decision.
- Candidate next signals are lookup-to-useful-result, bulk-lookup completion,
  seed/handoff-to-claim conversion, and media-kit management completion.
- Event names should record surface, view, entity type, bounded outcome, and
  source category only when privacy-safe; never raw content or sensitive
  attributes.
- Analytics absence must remain `unknown`, not evidence that a job or filter is
  unwanted.

## Out Of Scope

- a full booking marketplace that replaces specialized booking systems
- a free-edit wiki for rich biographies about other people
- a growth-marketing directory driven by opaque recommendations, trending
  claims, or paid ranking
- a rigid professional credential directory where self-expression roles imply
  qualification
- a universal social feed

DJ workflows remain in scope when they solve the current operator job, but
must use the shared identity model without losing their operator value.

## Threat Actors And Abuse Cases

- data-harvesting clients seeking private presence, attendance, membership, or
  sensitive traits
- impersonators or hostile submitters creating false, duplicate, or invasive
  records
- coordinated vocabulary, alias, review, report, or claim abuse
- malicious sources attempting to launder private or false data through
  provenance labels

These are adversaries the privacy, moderation, authorization, and rate-limit
systems must resist, not users whose feature requests are merely out of scope.

## Open Owner Decisions

- When, if ever, should role assertions gain field-level attestation?
- What provenance states may qualify for strict role filtering?
- Which role aliases should be reviewed and normalized first?
- What real data density is enough to add genre or community-category facets?
- Does owner-authored availability belong in VRDex core or an integration?
- Which event/discovery time presets fit international users and current data?
- Should approved public copy eventually have a lightweight inventory, or is
  exact approval evidence in each task handoff sufficient?
- When should localization move from preservation of names/local time into
  translated product UI?
- Should the DJ preset remain person-only, and how should duos, collectives, or
  community-operated acts appear without creating a second identity model?
