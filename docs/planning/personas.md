# Product Personas And Taste Lenses

## Status

Current recommendation. Personas describe expected tastes, trust needs, and
reactions; jobs to be done describe session goals and journeys. Neither is a
feature requirement, public label, search facet, or schema field. Jobs are
documented separately in `docs/planning/jobs-to-be-done.md`.

## Evidence Labels

- `Repository evidence`: verified in the repository, current product surface, or
  an adjacent active task.
- `Fable judgment`: product or taste judgment from the isolated Fable 5 review.
- `Assumption`: a useful hypothesis that still needs interviews or analytics.
- `Open owner decision`: a choice BASIC has not locked.

## Evidence And Limitations

Repository evidence:

- VRDex covers identity, profiles, events, and scene operations. Near term, it
  helps operators reuse approved links, assets, genres, set times, and
  publishing materials
  (`docs/planning/product-direction.md`).
- People and communities are first-class profile entities. Profile identity,
  account ownership, claim state, publication state, provenance, and field
  visibility are already separate concepts
  (`docs/backend/profile-schema.md`).
- Current surfaces include direct search and DJ Lookup, public person and
  community profiles, claim/linking, event and world pages, reviewed seed
  imports, and early media-kit support.
- The active Unified Search task treats DJ Lookup as a typed presentation
  preset over one search system. It does not treat `DJ` as a verified
  credential or strict eligibility fact.
- The active Media Kit task is building owner management over existing
  file-backed profile assets without changing search's identity projection.
- Current analytics cover bounded search, lookup, discovery, claim, and
  temporal-service events. They do not establish persona prevalence or user
  motivations (`docs/agentic/product-analytics-and-feature-flags.md`).

Limitations:

- No user interviews, demographic study, persona survey, or persona-level
  behavioral analysis was available.
- Maintainer-authored archetypes and product choices are directional evidence,
  not proof that real users fit a segment.
- No synthetic analytics or user quotes were created for this work.
- Accessibility and international needs are derived from general product
  obligations, viewer-local time behavior, and known schema/UI constraints;
  they are not backed by a dedicated VRDex accessibility or localization
  study.
- The isolated Fable 5 pass was read-only and used repository evidence. Its
  conclusions are judgments, not observed user research.

## Independent Fable Pass

Audit record:

- session: `f081c00b-ff47-41fe-b456-ed7ce25c3992`
- requested and returned model: `claude-fable-5`
- repository access: read-only `Read`, `Glob`, and `Grep` in plan mode, with no
  settings sources or MCP servers
- synthesis and VR Johnny review: same isolated session with tools disabled
- context prompt SHA-256:
  `d62c3708b093eb6bcdd7669bc631675dbdb0cb8b346833240f343de66066a40b`
- synthesis prompt SHA-256:
  `eecc7f5116a0dc608360dd16c866371ea1d7c649186afb0c1959535925d9355a`

## Provisional Behavioral Lenses

These personas are deliberately role-agnostic. The same person may be a DJ,
organizer, attendee, community staff member, and photographer at different
times without becoming a different identity or persona. They are unordered
research lenses until interviews or analytics justify prevalence or priority.

### 1. Utility-First User

`Assumption`

Values direct utility, compact facts, task-familiar language validated across
relevant communities and locales, and outputs that save a concrete step.
Tolerates dense operator surfaces when density is useful. Reacts poorly to
generic marketing, repeated data entry, ceremonial onboarding, and
explanations that delay the task.

Likely trust tests:

- notices whether links and assets are current, attributable, and easy to reuse
- tests lookup with stable names and sparse profiles
- reacts when profile-provided, imported, and verified facts look equivalent

Likely reactions:

- positive when VRDex behaves like a dependable scene utility
- negative when it behaves like a corporate landing page or forces every job
  through one generic dashboard

### 2. Representation-Conscious User

`Assumption`

Pays close attention to how a person or community is represented, whether
viewing their own record or helping maintain a community record. Values
tasteful control over public identity, links, media, visibility, and
presentation. Reacts poorly to ugly defaults, lost attribution, content that
speaks in somebody's voice without consent, or a claim flow that does not lead
to meaningful control.

Likely trust tests:

- notices when ownership and verification are conflated
- expects imported or community-submitted facts to remain reviewable
- checks whether visibility controls survive every surface
- rejects media-kit presentation that is either generic or a raw page builder

### 3. Privacy-Conscious User

`Repository evidence` supports the concern; the persona framing remains an
`Assumption`.

Evaluates VRDex first as a possible listing, tracking, ranking, or inference
surface. May value a profile while rejecting broad discovery, contact
exposure, public attendance claims, inferred presence, or opaque
personalization.

Likely trust tests:

- checks whether opt-out and suppression propagate across connected surfaces
- looks for source and visibility boundaries around public facts
- expects private signals to stay private by default
- tests whether correction, dispute, claim, and deletion paths are real

Likely reactions:

- one privacy leak across connected surfaces can outweigh many assurances
- effective controls and restrained labels build more trust than reassurance
  copy

### 4. Evidence-Sensitive User

`Assumption`

Notices provenance, claim/control state, freshness, and gaps across many jobs.
Reacts poorly when sparse imported profiles look as authoritative as claimed
rich profiles or when self-expression is presented as verified eligibility.

Likely trust tests:

- distinguishes claim/control, fact source and attestation, public visibility,
  and freshness without treating them as one status
- notices when role tags imply authorization, qualification, or availability
- distrusts inferred values that fill missing data

## Taste Lens: VR Johnny

`Owner-directed proposal; BASIC must approve this exact wording before this
change merges`.

VR Johnny is BASIC's owner-authored tone-risk stress test: a stand-in for one
ordinary VR-community user who may reject copy that feels corporate,
patronizing, AI-promotional, AI-generated, or slop-like. It is not a
demographic category, a claim about all VR users, or observed evidence. The
owner-provided name does not encode gender, a cultural majority, or one
preferred VR subculture.

Use VR Johnny only as a product-copy and design-taste stress test:

- ask whether new public prose sounds direct, human, and appropriate to the
  surface without assuming one scene dialect
- remove, shorten, or plain-speak prose that sounds promotional, patronizing,
  synthetic, or written merely to fill space
- prefer useful data, direct labels, and owner/community content
- never cite VR Johnny as evidence for adding, prioritizing, or designing a
  feature
- never turn VR Johnny into a public label, segment, filter, analytics
  property, or schema field

`Fable judgment`: treat VR Johnny as a veto lens, not a behavioral segment,
median user, or source of evidence.

## Public Product Copy Rule

`Owner-directed proposal; BASIC must approve this exact wording before this
change merges`.

The canonical operational copy is in `AGENTS.md`. It is repeated here so the
persona artifact remains self-contained; update both copies together.

- Every substantive new word of public-facing product or website prose must be
  evaluated through the VR Johnny lens.
- Obvious one- or two-word utility labels and exact strings matching an
  already-approved pattern may proceed. When in doubt, treat copy as
  reviewable.
- New taglines, marketing copy, onboarding or help prose, explanatory cards,
  empty-state prose, profile or media-kit guidance, and other authored
  sentences require BASIC's review of the exact copy before shipping unless
  BASIC already approved that exact copy.
- Do not foreground or mention AI to users without explicit owner direction.
- Fable and blind review may improve a draft but cannot substitute for BASIC's
  approval.
- Preserve existing approved copy unless a task has a concrete reason to
  change it. Do not invent explanatory prose because a layout has space.
- This rule applies to public-facing product copy. It does not apply to code,
  tests, internal engineering prose, accessibility names that must be
  explicit, or required safety and legal text.
- A task that changes public prose must show the exact proposed wording in its
  handoff and identify BASIC's approval before shipping.

This rule does not authorize silent changes to existing public copy.

## Cross-Persona Needs And Failure Modes

These cells are unvalidated reaction prompts. System invariants such as
suppression, visibility, accessibility, and provenance apply to everybody;
their placement in one column never makes them persona-specific.

| Need | Utility-first user | Representation-conscious user | Privacy-conscious user | Evidence-sensitive user | Common failure |
| --- | --- | --- | --- | --- | --- |
| Direct identity lookup | Speed and dense useful facts | Canonical self-presentation | No hidden resurfacing | Provenance and gaps | A generic or stale result looks authoritative |
| Sparse/imported profiles | Useful minimal fallback | Clear path to claim and correct | Publication restraint and opt-out | Import source is visible | Seeded graveyard of thin, unclaimed profiles |
| Claimed rich profiles | Reusable links and assets | Control and polish | Field visibility | Owner-confirmed facts | Claim appears to verify every field |
| People and communities | Familiar task language | Appropriate owner controls | Same privacy guarantees | Clear entity type | Community staff roles are mistaken for identity tags |
| Multi-role lives | One identity reused across work | Owner-editable expression | No inferred role history | Scoped role provenance | One role becomes a permanent account class |
| International use | Local time and portable output | Local language and names survive | Region is not overexposed | Time and source are legible | Freeform region becomes a proxy for sensitive traits |
| Accessibility | Keyboard-efficient workflows | Meaningful media descriptions | No privacy loss through alternatives | Trust state is not color-only | Sparse or decorative media has unusable alternatives |

## Interview Targets

Interview later:

- operators who currently assemble lineups, links, assets, and timestamps
- owners of claimed profiles and recipients of concierge/handoff profiles
- people or communities who were listed by somebody else
- users who rejected or abandoned comparable community tools because of tone,
  privacy, or trust
- non-club communities to test whether current personas generalize beyond the
  DJ/event wedge
- international and disabled users before adding location, language, media,
  or interaction assumptions
