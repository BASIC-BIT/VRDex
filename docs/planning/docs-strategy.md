# Documentation Strategy

## Goal

Use documentation as a real product asset from day one, for both humans and agents.

## Why Docusaurus

- good for structured docs
- works well in-repo
- supports multiple doc sections
- easy for humans to browse
- easy for agents to cite and revisit

## Recommended split

### Public docs

Purpose:

- product docs
- user guides
- partner integration docs
- public API docs
- trust and privacy explanations

Suggested route:

- `/docs` or site root in docs-only mode

### Internal docs

Purpose:

- engineering decisions
- moderation playbooks
- rollout plans
- AI/operator notes
- integration negotiations and implementation notes

Suggested route:

- `/internal`

## Important caveat

Docusaurus can organize docs into public and internal sections, but it does not magically make a route private.

For actual privacy, use one of these:

1. separate internal deployment
2. app-layer auth in front of internal docs
3. keep some docs in-repo but not deployed publicly

## Best practical setup

Recommended default:

- same repo
- Docusaurus for canonical docs
- public docs deployed publicly
- internal docs either excluded from public deploy or shipped behind auth later

## Agent strategy

Skills should stay thin.

Good pattern:

- skill points agent to canonical docs page(s)
- docs hold the evolving truth
- skill provides workflow framing, not duplicated content

This keeps humans and agents on the same source of truth.

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

Even if internal docs are not private at first, the structure is still worth it. You can tighten privacy later without rethinking the whole documentation model.
