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
- `Docusaurus` for browsable public/internal docs sourced from repo markdown

Likely adjacent service use:

- AWS email capabilities for verification and transactional mail
- AWS S3 for private profile media-kit assets, with [#115](https://github.com/BASIC-BIT/VRDex/issues/115) owning the first Terraform/runtime baseline and later issues owning lifecycle hardening

Status: locked stack direction.

Why this fits:

- `perkcord` already shows a close precedent for `Next.js + Convex + Stripe`
- `meeting-notes-discord-bot` already shows strong Stripe, AWS, Playwright, and visual testing patterns
- unified typing stays strong across app and backend logic

Current recommendation:

- bootstrap Convex in the repo-root `convex/` directory so backend functions stay easy to discover in a small monorepo
- keep the first backend slice schema-light with an explicit health query instead of guessing at product tables too early
- use local-development-friendly Convex setup first, then layer in frontend wiring, auth, billing, and production deployment posture through follow-on issues
- once the local backend bootstrap is deterministic, include it in the baseline PR verification pass alongside the web checks
- use one explicit server-side App Router baseline once client wiring is stable: `fetchQuery` for server-only reads, with `preloadQuery` deferred until a feature truly needs hydrated reactivity after server render
- use Vercel previews as the first hosted validation path for the web app, with `apps/web` as the project root and `/api/deployment` as the live environment identity endpoint
- use `apps/docs` as the Docusaurus shell over canonical repo-root `docs/` markdown, with `pnpm build:docs` as the static docs verification path

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
- design API docs as both human-readable and agent-consumable, with task examples and machine-readable schema docs
- treat a portable VRDex skill as a product integration artifact for external repos, separate from repo-local onboarding skills used by VRDex maintainers
- keep a standalone VRDex MCP as the default long-term direction, with optional VRChat MCP bridge tools only where cross-context workflows justify the coupling
- keep any VRChat credential-backed bridge local/operator-owned; do not make public VRDex services depend on private VRChat cookies, local presence, or bridge-only context

Agent-facing integration direction:

- canonical portable skill guidance should live in Docusaurus-visible docs, with `skills/vrdex/SKILL.md` acting as a compatibility pointer for agent tooling
- public docs should include stable route/API patterns, trust/provenance rules, and examples for partner agents
- website navigation guidance should exist, but structured data should prefer API or MCP over scraping
- a future VRDex MCP should use the VRChat MCP pattern of curated tools first, generated API coverage second, compact outputs, and IDs/slugs for follow-up calls
- optional bridge tools should expose provenance and freshness, and should feed private operator workflows rather than public profile/event facts

Infra direction:

- Terraform is the current primary IaC path for hosted bootstrap stacks
- prefer infrastructure-as-code or checked-in config for infrastructure, CI settings, and environment variable definitions whenever the platform supports it
- for secrets that must remain in provider secret stores, commit the expected variable name, environment scope, owning service, and rotation/recreation path instead of relying on dashboard-only tribal knowledge
- treat manual dashboard changes as bootstrap or emergency operations that need a follow-up reproducibility artifact
- use `docs/developers/self-hosting-and-iac.md` as the current hosted vs self-hosted deployment reference
- use `docs/deployment/aws-baseline.md` as the current SES and S3 asset-storage baseline
- keep profile asset storage narrow: private S3, Block Public Access, server-side encryption, and app-generated presigned URLs before any CDN or image-processing layer

## Follow-on integration ideas

Candidate direction:

- Google Calendar import, integration, and export
- personalized synced calendars for the events a user cares about
- reviewed event candidates imported from selected public or operator-owned calendars
- optional separate calendars by person/community or one merged calendar depending on user preference
- a simpler service-account-managed shared-calendar approach may be a good early implementation path before deeper per-user sync
- Notion integration is a hairier candidate direction for event-planning imports/exports and should be validated with organizers before implementation

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

Use this rule set for placing agent-facing knowledge without over-promoting long workflow detail into every session.

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

Product-facing distinction:

- repo-local skills help VRDex maintainers and implementation agents work inside this repo
- a portable VRDex skill would help external partner agents integrate with VRDex from their own repos
- portable product skills should stay small and route to public docs, API examples, website navigation guidance, and MCP docs instead of duplicating all product knowledge inline

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
- VRDex public profile/event/partner integration tools

Good test:

- if the capability exists outside the repo and will be reused often, MCP is a strong candidate

VRDex-specific note:

- standalone VRDex MCP is likely safer and cleaner than folding the whole surface into VRChat MCP because VRDex public data, profile claims, partner sync, and event metadata are not the same auth boundary as a local VRChat account
- VRChat MCP bridge tools can still be valuable later for resolving VRChat users/groups/worlds/events into VRDex records

### LLM / Agent Observability

Use for:

- traces, evals, prompt-quality analysis, cost/latency, and loop diagnostics for repo/product agents
- review/recycle outcomes and false-positive disposition tracking

Current recommendation:

- keep LLM/agent observability separate from product analytics and feature flags
- do not adopt a dedicated platform until current artifacts stop being enough for traces, evals, or loop diagnostics
- treat `Langfuse` as the first candidate to evaluate if a dedicated platform becomes necessary
- do not capture prompt text by default until redaction, privacy, and retention rules exist

Canonical details live in `docs/agentic/software-factory.md` under `LLM and agent observability`.

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

## Historical VRDex repo setup guidance

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

## Remaining setup references

Keep these references current as product implementation fills in the remaining gaps:

1. issue/epic breakdown from the PRD: `docs/planning/dependency-map.md`, `docs/planning/epics.md`, and GitHub issues
2. trust-state / badge-state docs: `docs/backend/profile-access-and-claims.md` and related public trust docs once promoted
3. billing and entitlement docs: create/update when billing work starts
4. testing protocol docs: `docs/testing/` and `docs/agentic/definition-of-done.md`
5. Docusaurus structure: `apps/docs`, `docs/README.md`, and `docs/planning/docs-strategy.md`
