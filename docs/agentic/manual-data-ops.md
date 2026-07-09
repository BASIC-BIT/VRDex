# Manual Data Ops

## Status

Current recommendation until VRDex has a first-class MCP or admin console for
operator data changes.

## Purpose

Manual data manipulation is allowed only as a controlled bridge. The goal is to
make small, intentional Convex data changes for demos, cleanup, and production
support without bypassing provenance, consent, public-surfacing, or readback
rules.

## Data Categories

Locked decision:

- Playwright fixtures are deterministic UI/test data. They live in
  `apps/web/src/convex/playwright-fixtures.ts`, are disabled in production, and
  should stay useful for `/lookup?q=lineup` visual tests.
- Reviewed seed-import fake fixtures are import-workflow staging records. They
  do not publish canonical profiles by themselves.
- Real friends, DJs, communities, worlds, and events used for production
  feedback are live canonical records. They need consent, safe public fields,
  provenance, and public readback.

Current recommendation:

- Do not add a broad `is_mock` flag to every table for one-off demos.
- Model future mock/demo behavior as an explicit system with root-entity mock
  isolation plus sparse demo-surface curation if the product still needs it.
- For near-term friend feedback on the DJ lookup page, create or update a tiny
  set of consenting real person profiles and let `/lookup` read the same public
  profile/search path as ordinary users.

## Production Safety

Before any production write:

1. Read the current target from `docs/deployment/convex-environments.md`.
2. Confirm the exact Convex deployment and web domain with live readback.
3. State the intended records and fields.
4. Ask for explicit approval before applying the mutation.
5. Keep a rollback plan, usually by recording previous values and avoiding hard
   deletes.

Never use production E2E helper routes or Playwright fixture toggles for manual
production data changes.

## Preferred Write Path

Prefer this order:

1. Existing product mutations when they already enforce the right invariants.
2. Repo scripts or internal Convex mutations that can be reviewed and committed.
3. One-off Convex CLI calls with the exact deployment and arguments captured in
   the session.
4. Dashboard edits only for emergency or bootstrap cases, followed by docs or
   script backfill.

Manual writes must preserve:

- `publicationState`
- `publicSurfacingState`
- `claimState`
- `fieldVisibility`
- source/provenance fields
- search documents and vocabulary records
- short links when needed
- audit events when the operation changes public identity or visibility

## DJ Lookup Demo Profile Checklist

For a consenting real person shown on `/lookup`:

- Use `profileType: "person"`.
- Use `creationSource: "moderator"` or another intentionally chosen source.
- Keep `claimState: "unclaimed"` unless a real claim flow grants ownership.
- Set `publicationState: "published"` and `publicSurfacingState: "public"` only
  when consent and opt-out expectations are clear.
- Add concise public fields only: display name, aliases, role tags, genres,
  public outbound links, region/timezone if consented, and public HTTPS images
  only when rights are clear.
- Refresh the profile search document and vocabulary after the write.
- Verify `/lookup/suggest?q=<name>` and `/p/<slug>` from the deployed web app.

## Readback

A manual data op is not complete until readback proves the intended public
surface:

- Convex query or internal read confirms the target row values.
- Search/lookup query returns or hides the record as intended.
- Public route or API route renders only the safe public projection.
- Production/staging target is named in the final report.

## When To Build More System

Use a real feature PR instead of one-off data ops when the request needs:

- repeated imports from partner lists
- reviewer UI
- mock cohorts mixed with live records
- owner handoff or claim confirmation
- public API/MCP access for writes
- broad data cleanup or migrations
