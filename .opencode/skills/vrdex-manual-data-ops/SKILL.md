---
name: vrdex-manual-data-ops
description: Safely inspect, plan, apply, and verify manual VRDex Convex data changes before a first-class MCP/admin surface exists. Use for production or staging profile/event/world data fixes, consented demo profile creation, search-index readback, fixture-vs-live-data questions, and one-off operator data manipulation that must preserve provenance, public-surfacing rules, and auditability.
metadata:
  audience: maintainers
  domain: data-ops
---

## Goal

Perform manual VRDex data operations without treating the database like a scratchpad.

## Read First

- `AGENTS.md`
- `AGENTS.local.md` when present
- `docs/agentic/manual-data-ops.md`
- `docs/deployment/convex-environments.md`
- Relevant schema docs under `docs/backend/`

## Core Rule

Separate fixture data, staged import candidates, and live canonical records.

- Playwright fixtures are good deterministic dummy data for local UI and visual tests.
- Seed-import fake fixtures are staging records for import workflow tests.
- Consented friends or real DJs belong in live canonical profile records with provenance and readback.

## Workflow

1. Identify the target environment before any write: local, staging/dev, or production.
2. Prefer existing product mutations, internal mutations, or scripted Convex calls over dashboard editing.
3. For production writes, get explicit user approval with the exact target deployment and intended records.
4. Keep real-person data minimal, consented, public-safe, and reversible.
5. Preserve `publicationState`, `publicSurfacingState`, claim state, field visibility, source/provenance, search documents, vocabulary, short links, and audit events.
6. Do not enable production E2E helpers or use Playwright fixture paths as production data.
7. After every write, verify direct Convex readback plus the relevant public route or API surface.

## DJ Lookup Demo Notes

- `/lookup` uses public person `searchDocuments`.
- The existing good dummy lineup lives in `apps/web/src/convex/playwright-fixtures.ts` and is disabled in production.
- Adding a consenting friend for production feedback should create or update a real person profile and refresh lookup/search artifacts.
- Mock/demo curation is a separate product feature; do not overload a live profile with broad mock-only flags unless the schema has been explicitly designed for it.

## Stop Conditions

Stop and ask before:

- writing production data without a current target readback
- importing real partner or third-party lists
- storing secrets, private contact details, raw provider IDs, or non-public notes
- changing billing, auth, claim, suppression, or public API semantics
- deleting or overwriting owner-authored fields
