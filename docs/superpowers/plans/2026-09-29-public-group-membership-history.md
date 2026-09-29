# Public Group Membership History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show public total VRChat group membership history for a community's primary linked group, with independent Appearance switches for the count and graph.

**Architecture:** Group-level snapshots allow a linked group to have data without a joined collector. The public projection combines these with existing connected observations behind the Group size visibility gate. Appearance controls render only, and a client chart distinguishes observed history from the creation-to-first-observation bridge.

**Tech Stack:** Convex, Next.js, TypeScript, worker JavaScript, Recharts.

**Spec:** docs/superpowers/specs/2026-09-28-public-group-membership-history-design.md

## Global Constraints

- Group size visibility is the only public data access gate; Appearance switches never grant or revoke API access.
- Both Appearance switches are independent, default true, and affect community public pages only.
- Retain count observations permanently. Never infer a zero from provider failure.
- Use the primary active VRChat group link; connected integration may provide a fallback.
- Dotted creation-to-first-observation history is labeled Unobserved. Observed points use a solid line.
- Public projection contains aggregate counts only; no group ID, member identity, collector state, or private coverage.
- No new public prose beyond the spec's exact proposed labels without BASIC's approval.

## Review Focus

- Multiple profiles linked to one group must share snapshots without sharing visibility.
- Link removal or replacement must stop displaying the old group's series.
- Provider 429/401 must preserve the last timestamped count and respect existing budgets.
- Count hidden with graph visible, and graph hidden with count visible, must each work.
- Unconnected profiles must receive their first point without requiring the bot to join.

### Task 1: Group snapshots and worker collection

**Files:** convex/schema.ts, convex/communityTelemetry.ts or a focused internal module, workers/group-telemetry/vrchat-client.mjs, worker control routes, worker tests, docs/backend/community-group-telemetry.md.

**Interface:** Persist vrchatGroupMemberSnapshots rows with vrchatGroupId, memberCount, observedAt, optional groupCreatedAt. Index by_vrchatGroupId_observedAt. Expose a bounded internal claim/result path for linked primary groups. Existing connected polls may write the same row shape; do not duplicate a provider GET.

- [ ] Write one failing collector test for an unconnected linked group and one for provider failure preserving the previous point.
- [ ] Add the indexed snapshot table and the minimal due-work path using the existing worker credential and budget.
- [ ] Capture and validate group creation time from the provider response.
- [ ] Record changed counts or a daily heartbeat idempotently; keep old observations.
- [ ] Run focused worker and Convex checks; update backend docs; commit.

### Task 2: Visibility-gated public projection

**Files:** convex/_communityTelemetryPublic.ts or a focused helper, convex/profiles.ts, packages/api-contracts/src/schemas.ts, public projection tests.

**Interface:** Public profile groupMembership?: { groupCreatedAt?: number; latest: { value: number; observedAt: number }; points: Array<{ observedAt: number; value: number }> }. Return at most 500 observed points, with earliest and latest retained; document range sampling if needed.

- [ ] Write failing tests for Group size public vs nonpublic, unconnected link, changed link, and per-profile visibility.
- [ ] Resolve primary active link, with connected integration fallback, and read group snapshots plus existing connected observations through indexes.
- [ ] Add optional public contract field without changing existing telemetry fields.
- [ ] Run public API and authorization tests; commit.

### Task 3: Appearance controls

**Files:** convex/schema.ts, convex/_profileAppearance.ts, convex/profileAssets.ts, apps/web/src/app/account/appearance/appearance-panel.tsx, appearance tests.

**Interface:** showMemberCount and showMemberHistory optional persisted booleans; missing means true. updateAppearance accepts them for community profiles. PublicProfileAppearance returns normalized booleans.

- [ ] Write failing test for all four combinations and persisted defaults.
- [ ] Add owner-controlled booleans to the existing preference and Appearance save flow.
- [ ] Add two independent community-only checkboxes labeled Show member count and Show membership graph.
- [ ] Run focused tests and typecheck; commit.

### Task 4: Public chart and integration

**Files:** apps/web/src/app/_components/profile-public-page.tsx, new focused client chart component, public page tests/stories, docs/backend/community-group-telemetry.md.

**Interface:** Consume Task 2 groupMembership and Task 3 appearance fields. Count card and chart render independently behind projected data. Use installed Recharts.

- [ ] Write a failing render test for each switch combination, a single observed endpoint, and a missing creation time.
- [ ] Render observed line and dotted Unobserved bridge with inspectable date/count tooltips; never connect missing measured intervals.
- [ ] Inspect desktop and mobile screenshots with VLM, fix visual issues, and run focused tests, lint, and typecheck.
- [ ] Integrate leaf commits, run full relevant verification, and request whole-branch review.
