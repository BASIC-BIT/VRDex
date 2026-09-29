# Club analytics implementation kickoff

Status: implementation started following BASIC's September 12 instruction. Deliver the accepted slices in order. This checkpoint covers slice 0 and maps integration work for slice 1; it is not a claim that the entire program is implemented.

## Source of truth

- Approved discovery: [group analytics discovery](../group-instance-analytics-discovery-2026-09-08.md).
- Slice 1 spec: [staff and visibility design](2026-09-10-club-staff-and-visibility-design.md), including the September 11 accepted review corrections.
- Planning archive: [PR #337](https://github.com/BASIC-BIT/VRDex/pull/337).
- Shared navigation to reconcile before UI integration: [PR #338](https://github.com/BASIC-BIT/VRDex/pull/338).

## First implementation checkpoint

Slice 0 removes age-based raw telemetry deletion, keeps rollup generation, updates retention documentation and proves old aggregate and instance observations survive rollup processing. Work runs in an isolated checkout based on refreshed main, not the September 3 root branch. Keep this a separately reviewable change before staff schema work. No provider calls, live migrations or deployment are part of the local checkpoint.

## Slice 1 integration map

1. Introduce roles, invitations, category visibility and action-log tables in `convex/schema.ts`, then centralized permission and visibility helpers. Migrate existing action callers in `events.ts`, `_shortLinks.ts` and `communityTelemetry.ts` with regression tests before adding UI consumers.
2. Preserve the identity utility boundary. `_communityAuthority.ts` also supplies `AuthSubject` and `toAuthSubject` to ownership, browser-session, profile, seed and media modules. Replacing the authority module must update all imports or retain a compatibility export. Avoid a cycle in which `_clubAccess.ts` imports `_browserSessionAuthority.ts`, which imports the new access module back. A small identity-only module can hold the shared type and conversion function.
3. Implement role and invitation mutations with atomic inviter-authority revalidation at acceptance. The signed-in recipient supplies the active session; the stored inviter's current authority is looked up independently. Enforce community boundaries on every role reference and test invalidated delegation without partial assignments.
4. Introduce category visibility with legacy public-metric fallback. Existing net growth is protected immediately, including nested rollups and recaps. Keep the schema cleanup separate from the additive deployment and explicitly verified migration. Do not infer production table emptiness merely from the absence of ordinary write call sites.
5. Create the protected `(workspace)` route group below `account/communities/[slug]`. Keep invitation acceptance outside that group. The existing account session boundary waits for authentication initialization; it does not itself deny anonymous visitors. Preserve account replay masking and the sign-in return path while enforcing authorization in backend queries.
6. Move the existing telemetry content into Home, its connection form into Connection, and public toggles into Visibility. Add Staff and roles, then redirect the old telemetry URL. Reuse the approved Workspace hierarchy and shared UI primitives. Recharts and personal widget customization remain slice 2.

## Required evidence for slice 1

- Backend: permission union, community isolation, revoked role handling, bounded delegation, atomic single-use invitation acceptance, invalidated inviter, audience filtering, and legacy migration compatibility.
- Browser: signed-out invitation route, sign-in return, non-staff acceptance, denied private routes before acceptance, allowed workspace entry afterward, and safe empty/disconnected states.
- Visual: desktop and mobile views of Home, Staff, Visibility and Connection against the approved preview.
- Repository checks: backend typecheck and tests, affected web tests/typecheck, generated API checks and documentation validation. A fixture-only invitation test does not establish that real route layouts work.

The approved preview remains a visual reference. Its simulated permissions and in-memory actions are not reusable authorization or scheduling implementations.

## Local implementation checkpoint, September 14

Slice 0 is committed locally as `c0f2e1c6d`. Slice 1 is implemented on `codex/club-staff-workspace` in the same isolated checkout. The [backend implementation guide](../../backend/club-staff-workspace.md) records authority, invitation, visibility and migration behavior.

The implementation preserves legacy capability grants and keeps an owner-only `setPublicMetric` compatibility entry point during the additive transition. New visibility settings are authoritative once written. These compatibility choices avoid assuming deployed records are empty or every client updates at once.

Verification covers backend and web test suites, backend and web typechecks, web lint, documentation lint/build and fixture visual review. An isolated anonymous local Convex instance also loaded the functions, generated API types and returned a healthy status. Fixture rendering and backend mutation tests do not establish the complete authenticated browser journey against a hosted deployment. That journey, the explicit production visibility migration and exact public-copy review remain release work. No provider writes, live migration, merge or hosted deployment are included in this checkpoint.
