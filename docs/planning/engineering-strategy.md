# Engineering Strategy

## Goal

Build `VRDex` as both a product and a software-factory proving ground.

That means:

- product decisions are documented early
- testing and review loops exist from day one
- reusable agent knowledge has a clear home
- the repo is designed for long-running autonomous iteration, not just one-off coding sessions

Locked direction:

- the project should be built in the open
- the project should be self-hostable
- infra and automation should be committed as code where practical

Important planning note:

- this document should separate confirmed engineering decisions from provisional recommendations
- when a recommendation is only a reasonable first pass, mark it as such and leave an interview follow-up

## Recommended stack

### Product stack

- `Next.js` for the web app
- `TypeScript` everywhere
- `Convex` for application data/functions/scheduled workflows
- `Stripe` for payments and billing portal
- `AWS` for assets and surrounding infra that fits better there
- `Vercel` for fast web previews and frontend deployment ergonomics

Likely adjacent service use:

- AWS email capabilities for verification and transactional mail

Status: locked stack direction.

Why this fits:

- `perkcord` already shows a close precedent for `Next.js + Convex + Stripe`
- `meeting-notes-discord-bot` already shows strong Stripe, AWS, Playwright, and visual testing patterns
- unified typing stays strong across app and backend logic

## Monetization direction

VRDex should plan for billing early even if the first paid features are modest.

Candidate plan model for later validation:

- free
- creator pro
- community pro
- later: business / agency tier if justified

Current recommendation:

- free should include normal operational collaboration for communities
- paid tiers should emphasize premium customization and deeper insights
- avoid charging for the ability to simply run a community profile with staff

Possible entitlement examples:

- advanced themes
- premium event analytics
- advanced community profile modules
- roster management
- custom links/blocks caps
- enhanced moderation/support tools

Interview later:

- whether creator and community plans are the right first packaging
- whether communities subsidize creator features or vice versa
- whether the earliest paid wedge is customization, analytics, staffing, or event tooling

## Billing architecture

Use the Perkcord mental model here:

- billing events should update internal entitlements
- product behavior should read internal entitlement state, not Stripe directly
- webhook processing must be idempotent and auditable

Suggested core records:

- billing customer
- subscription
- plan entitlement snapshot
- payment event audit

## Open platform architecture

Current recommendation:

- publish a documented public API
- apply explicit rate limiting and client-aware limits
- keep infra-as-code in the repo
- design for a later public or self-hostable MCP surface

Infra direction:

- Terraform and/or AWS CDK are both acceptable directions
- choose one primary IaC path before implementation gets too far

## Follow-on integration ideas

Candidate direction:

- Google Calendar integration and export
- personalized synced calendars for the events a user cares about
- optional separate calendars by person/community or one merged calendar depending on user preference
- a simpler service-account-managed shared-calendar approach may be a good early implementation path before deeper per-user sync

This is a strong workflow feature, but not part of the first product slice.

## Verification and testing factory

### Baseline quality gates

- lint
- format
- typecheck
- unit tests
- integration tests
- coverage reporting

### Product confidence loops

- Playwright e2e for critical paths
- Playwright visual regression for key pages
- screenshot diff artifact uploads in CI
- VLM review of changed screenshots for UI work

UI workflow recommendation:

- let GPT handle UI work too
- require a visual verification loop for meaningful UI changes
- capture screenshot evidence and review diffs before calling UI work done

### Deeper verification layers

- AST-grep or equivalent structural lint rules
- unused dependency detection
- dead code checks
- preview environment smoke tests
- review-recycle loops after automated PR reviews

### Nice-to-have later

- automatic feature demo capture as video/GIF
- VLM-generated summary of screenshot changes for PRs

## Definition of ready

Current recommendation:

- before feature work starts, define the rollout plan, verification plan, and success signals
- when appropriate, define whether the feature should ship behind a feature flag
- when appropriate, define what analytics or product signals will tell us whether the feature is actually useful
- include contributor-facing expectations so newer programmers and outside agents know what good looks like without needing tribal knowledge
- treat `docs/agentic/definition-of-ready.md` as the canonical checklist and workflow reference

## Definition of done

Current recommendation:

- before calling non-trivial work finished, verify that implementation, verification, documentation, and rollout posture are all actually complete
- treat `docs/agentic/definition-of-done.md` as the canonical closeout checklist and handoff reference
- prefer explicit follow-up issues over quietly shipping with undocumented gaps

## Product analytics and experimentation

Current recommendation:

- treat product analytics and feature-flagging as part of the engineering system, not bolt-ons after launch
- prefer a setup that supports feature flags, controlled rollout, and experiments without locking the repo into one vendor too early
- avoid platform-integration hell by standardizing on one primary tool per concern unless there is a clear gap
- treat `docs/agentic/product-analytics-and-feature-flags.md` as the canonical policy for first-pass tool choice, rollout expectations, and product-signal expectations

## Contributor workflow posture

Current recommendation:

- be rigorous about quality bars and review loops without forcing every contributor into one specific agent or IDE workflow
- optimize for interoperability: contributors can use their preferred agents/tools so long as the work product fits the repo's review, docs, and verification expectations
- use reviewer/recycler automation to reduce slop, especially for newer contributors, without turning contribution into a hostile process
- treat `docs/agentic/contributor-workflow.md` as the canonical contributor contract and onboarding pointer

Candidate direction:

- add protected-branch and contributor-role standards once active collaboration justifies it
- add lightweight contributor onboarding docs and review expectations before there are many outside contributions

## Agent knowledge architecture

This is the clearest rule set I would use.

### `AGENTS.md`

Use for:

- repo-wide rules
- safety boundaries
- default workflow expectations
- durable high-level decisions every agent should always know

Do not use for:

- long procedural docs
- fast-changing feature specs
- giant implementation playbooks

### Nested `AGENTS.md`

Use for:

- subtrees with special rules or local architecture
- areas like `apps/web`, `convex`, `docs`, or `e2e` if they need extra local context

Good test:

- if an agent working only in that subtree needs special rules, nested `AGENTS.md` is appropriate

### Skills

Use for:

- repeatable playbooks
- multi-step workflows
- domain-specific guidance that may be invoked on demand
- procedures like UI review loop, release checklist, billing debug flow, docs update protocol

Good test:

- if you want to explicitly invoke it later, it should probably be a skill

### Tools

Use for:

- deterministic helper actions
- narrow repeatable utilities
- tasks where you want direct machine behavior, not prompt interpretation

Examples:

- build a PR screenshot index
- tail a specific artifact log
- generate a docs index

### Plugins / hooks

Use for:

- event-driven enforcement
- automatic control loops
- behavior that should happen around many tasks without explicit prompting every time

Examples:

- auto-continue loops
- PR review watch
- session offboarding
- screenshot artifact reminders

Good test:

- if you keep wanting the system to react automatically to lifecycle events, it belongs in a plugin/hook, not a skill

Parallelization note:

- for VRDex, prefer parallelization through multiple OpenCode sessions when needed
- do not over-invest in in-session subagent complexity unless it proves clearly valuable

### MCPs

Use for:

- external systems or richer capability surfaces
- integrations where the model benefits from structured actions over APIs/services

Examples:

- GitHub
- Stripe
- Langfuse
- browser automation
- VRChat

Good test:

- if the capability exists outside the repo and will be reused often, MCP is a strong candidate

### Docusaurus docs

Use for:

- canonical human+agent readable product and engineering documentation
- PRD, integration docs, moderation policy, trust model, testing docs, rollout notes

Good test:

- if humans and agents both benefit from linking and browsing it, put it in docs

## Rule of thumb

Start with docs and simple scripts.

Graduate upward only when repetition justifies it:

1. docs / markdown
2. skill
3. tool
4. plugin / hook
5. MCP integration

## Decision-labeling rule

When documenting future VRDex decisions, prefer labels like:

- `Locked decision`
- `Current recommendation`
- `Candidate direction`
- `Interview later`

That keeps speculative planning from accidentally sounding final.

## Product realism rule

The agent should actively push ambitious ideas toward realistic, shippable slices.

Default posture:

- preserve the user's vision
- identify the smallest version that still creates real value
- avoid prematurely building the most granular or most abstract system possible
- call out when a simpler role model, entitlement model, or UX flow is likely good enough for v1

## Suggested VRDex repo setup

### Documentation

- Docusaurus from day one
- public docs
- internal docs
- ADRs for important design decisions

### Testing

- `unit`
- `integration`
- `e2e`
- `visual`
- `coverage`
- `policy`

### Initial durable docs

- PRD
- trust and verification model
- billing model
- profile state machine
- event ingestion and AI confidence model
- testing protocol
- docs strategy

## Immediate recommendation

Before implementation starts in earnest, create:

1. a stronger issue/epic breakdown from the PRD
2. a trust-state / badge-state document
3. a billing and entitlement document
4. a testing protocol doc
5. a first-pass Docusaurus structure
