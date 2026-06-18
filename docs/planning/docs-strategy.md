# Documentation Strategy

## Goal

Use documentation as a real product asset from day one, for both humans and agents.

## Why Docusaurus

- serves repo-root markdown through a browsable docs site
- supports separate public, developer, and engineering sections
- keeps docs easy for humans to browse and agents to cite
- fits the current in-repo source-of-truth model

## Recommended split

### Public docs

Purpose:

- product docs
- user guides
- trust and privacy explanations
- current user-facing behavior

Suggested route:

- `/docs/public`

### Developer docs

Purpose:

- public API docs
- partner integration docs
- self-hosting and deployment docs
- provider variable names and recreation paths
- agent-facing integration contracts such as portable skills and MCP read tools

Suggested route:

- `/docs/developers`

### Engineering docs

Purpose:

- engineering decisions
- alternatives considered
- moderation playbooks
- rollout plans
- AI/operator notes
- integration negotiations and implementation notes

Suggested route:

- `/docs/engineering`

## Important caveat

Docusaurus can organize docs into public, developer, and engineering sections, but it does not magically make a route private.

For actual privacy, use one of these:

1. separate internal deployment
2. app-layer auth in front of internal docs
3. keep some docs in-repo but not deployed publicly

## Best practical setup

Recommended default:

- same repo
- Docusaurus for canonical docs
- public and developer docs deployed publicly when they describe stable current behavior
- engineering docs may be deployed publicly only when safe; excluding or auth-gating them needs an owning issue, ADR, or deployment decision

## Agent strategy

Skills should stay thin.

Good pattern:

- skill points agent to canonical docs page(s)
- docs hold the evolving truth
- skill provides workflow framing, not duplicated content
- Docusaurus-visible docs are the canonical review surface for skill content that humans should maintain

This keeps humans and agents on the same source of truth.

Cross-linking matters: service pages, API pages, deployment pages, skill pages, and implementation notes should link to adjacent docs whenever behavior crosses boundaries.

## Future Work Link Rule

Any docs statement that says work is deferred, planned, future, or blocked on something that will be implemented later should link to an issue, ADR, project decision, or owning docs page.

Examples:

- `private S3 profile asset bucket ([#115](https://github.com/BASIC-BIT/VRDex/issues/115))`
- `public API route once the v0 API issue lands ([#39](https://github.com/BASIC-BIT/VRDex/issues/39))`

If there is no owning artifact, either create one or rewrite the sentence so it is clearly an uncommitted candidate direction rather than a silent obligation.

## Docs Faux Pas To Avoid

- Do not write generic hosted-vs-self-hosted platitudes such as "hosted can move faster" or "self-hosted should be able to reproduce the product shape." Say what is supported now, what configuration is required, and which issue owns the gap.
- Do not use `Not Yet Promised` laundry lists. Use `Out of scope for <issue/doc>` only when the boundary helps readers avoid a concrete misunderstanding.
- Do not add broad warnings such as "do not hard-code secrets" as filler. Tie them to exact variables, config files, provider objects, or tests.
- Do not leave canonical guidance in hidden tool folders when humans should review it. Docusaurus-visible docs are the canonical source; tool files should point back to them.
- Do not use `eventually`, `later`, `future`, `not yet`, or `once implemented` unless the sentence links to the owning issue, ADR, or decision artifact.
- Do not mix public product claims with implementation caveats. Put current user-facing behavior in public docs, external contracts in developer docs, and alternatives or constraints in engineering docs.
- Do not duplicate the same policy across pages. Prefer one canonical page and cross-link it from adjacent docs.

## Good internal doc categories

- product requirements
- design system rules
- data model decisions
- verification policy
- moderation policy
- integration contracts
- rollout and launch notes
- prompt and evaluation notes for AI-assisted features

## Recommendation

Start with Docusaurus on day one.

Even if internal docs are not private at first, the structure is still worth it. Privacy or access-control changes need an owning issue, ADR, or deployment decision before they become implementation claims.

## Current Scaffold

Locked decision:

- canonical markdown stays under repo-root `docs/`
- the Docusaurus app lives under `apps/docs`
- `apps/docs` reads `../../docs` directly instead of duplicating content into a second docs tree

Current recommendation:

- treat Docusaurus as the browse/build shell
- use `docs/public/`, `docs/developers/`, and `docs/engineering/` as the durable audience lanes
- keep legacy product planning, backend, testing, and agentic decisions in `docs/` until they are promoted into a lane
- add public/private deployment controls only after an owning issue, ADR, or deployment decision exists; route organization is not access control
- use `pnpm dev:docs` for local browsing and `pnpm build:docs` for static build verification

This satisfies the first docs scaffold and seed-content direction without claiming a separate internal deployment or auth-gated docs surface exists today.
