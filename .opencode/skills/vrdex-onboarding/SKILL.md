---
name: vrdex-onboarding
description: Onboard a new agent or maintainer to VRDex's repo structure, software-factory posture, and local-vs-global context model.
compatibility: opencode
metadata:
  audience: maintainers
  domain: meta
---

## Goal

Bring a new agent or maintainer into alignment with VRDex's repo conventions without bloating normal-session context.

## Read first

- `AGENTS.md`
- `docs/README.md`
- `docs/planning/README.md`
- `docs/agentic/README.md`
- `docs/agentic/software-factory.md`

## Local operator context

- If present, also read `AGENTS.local.md`.
- Treat `AGENTS.local.md` as personal/operator context, not repo policy.
- If absent, use `AGENTS.local.md.example` as the template/reference.

## What to internalize

- `VRDex` is intentionally opinionated toward software-factory and agent-first delivery.
- Safe routine work should continue through commit and push without repeatedly asking.
- Onboarding-heavy material belongs in docs/skills, not in every-session repo rules.
- Durable repo knowledge belongs under `docs/`.
- Product work and engine/meta-loop work are both first-class in this repo.

## Typical working pattern

1. Read the relevant planning docs under `docs/planning/`.
2. Read the relevant software-factory docs under `docs/agentic/`.
3. Do the work.
4. Update docs if workflow or architecture changed.
5. Commit and push safe routine work without waiting for an extra permission prompt.

## When to extend what

- Update `AGENTS.md` for durable repo-wide defaults.
- Update `AGENTS.local.md` only for operator-specific preferences.
- Add or update docs for durable human+agent reference material.
- Add or update skills for repeatable onboarding or playbook-style workflows.
