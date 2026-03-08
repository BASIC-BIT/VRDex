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
- club pro
- later: business / agency tier if justified

Current recommendation:

- free should include normal operational collaboration for clubs
- paid tiers should emphasize premium customization and deeper insights
- avoid charging for the ability to simply run a club profile with staff

Possible entitlement examples:

- advanced themes
- premium appearance analytics
- advanced club profile modules
- roster management
- custom links/blocks caps
- enhanced moderation/support tools

Interview later:

- whether creator and club plans are the right first packaging
- whether clubs subsidize creator features or vice versa
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
