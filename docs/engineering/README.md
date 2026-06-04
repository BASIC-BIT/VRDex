# Engineering Docs

## Purpose

Engineering docs capture decisions, alternatives, deep dives, current implementation constraints, and agent/operator workflow notes.

Audience:

- maintainers
- implementation agents
- reviewers
- the project owner when evaluating technical direction

## What Belongs Here

- architectural decision records and decision logs
- implementation deep dives
- alternatives considered and why they were rejected or deferred
- planning docs that are not current public product behavior
- backend schema and permission notes
- testing, deployment, and software-factory workflow details

## What Does Not Belong Here

- end-user docs that should be stable and concise
- developer-facing API contracts that outside consumers should follow directly
- private secrets or raw partner data

## Current State

Many existing docs still live in historical folders such as `docs/planning/`, `docs/backend/`, `docs/agentic/`, and `docs/testing/`. Treat those as engineering docs unless they are intentionally promoted into `docs/public/` or `docs/developers/`.

When a document mixes audiences, prefer extracting the public/developer surface into the appropriate lane and leaving alternatives, caveats, and implementation detail here.

Start with the [service cross-link map](./service-map.md) when reviewing how hosted services, docs, APIs, and implementation surfaces relate.

Use the [web design system](./design-system.md) when reviewing or extending shared UI primitives, Tailwind tokens, and visual consistency rules.
