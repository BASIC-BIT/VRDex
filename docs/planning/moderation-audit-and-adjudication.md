# Moderation Audit And Adjudication

## Status

Current recommendation.

This document captures the requirement that moderation and intelligence signals must be auditable and correctable before they become durable trust history. It is intentionally broader than profile moderation because the same model applies to future bot detections, server-level actions, global intelligence, bans, and appeal/review workflows.

## Problem

Operators and test accounts can accumulate suspicious detections while exercising the system. If those old detections keep flowing into future scoring, the system can repeatedly flag a user even after a human has determined the earlier events were false positives, test artifacts, policy-exempt activity, or otherwise not relevant.

Deleting old detections is the wrong fix. The system needs to preserve what happened while letting authorized reviewers decide whether a detection or action should count against a user, profile, account, server, or community in future accounting.

## Locked Decisions

- every detection, review, restriction, ban, dismissal, appeal, reversal, and override should be auditable
- adjudication should be additive, not destructive; do not erase historical evidence to restore standing
- future trust scoring should consume only active/countable signals, not raw historical detections by default
- global admins can adjudicate global intelligence and cross-server standing
- server admins can adjudicate server-scoped detections and server-local actions within their authority
- server-local adjudication must not silently erase global intelligence or another server's evidence
- AI/LLM output is evidence or a recommendation, not the final authority for trust state

## Core Concepts

### `moderation_events`

Immutable event ledger for facts observed or actions taken.

Examples:

- suspicious content detection
- suspicious activity detection
- user report
- model risk summary
- manual case opened
- warning issued
- restriction applied
- ban applied
- ban lifted
- message dismissed
- appeal submitted

Important fields:

- `scopeType`: `global`, `server`, `community`, or future product scope
- `scopeId`: optional scope identifier, such as Discord server id or community profile id
- `subjectType`: `user`, `profile`, `message`, `event`, `world`, `account`, or future subject type
- `subjectId`: stable internal subject id where available
- `sourceType`: `rule`, `llm`, `report`, `admin`, `integration`, `system`
- `sourceId`: model run id, rule id, report id, integration id, or actor id where relevant
- `eventType`: concrete event/action type
- `confidence`: optional normalized confidence for detections
- `reasonCodes`: normalized reason codes when available
- `summary`: short human-readable summary
- `evidenceRefs`: references to immutable evidence snapshots, not uncontrolled live links only
- `createdBy`: actor or system identity
- `createdAt`: event time

### `moderation_adjudications`

Append-only review decisions attached to one or more moderation events.

Examples:

- `upheld`
- `false_positive`
- `test_artifact`
- `policy_exempt`
- `duplicate`
- `stale`
- `locally_ignored`
- `globally_ignored`
- `reversed`
- `partial`

Important fields:

- `eventIds`: one or more moderation event ids covered by the decision
- `scopeType` and `scopeId`: adjudication scope
- `decision`: normalized decision
- `countsForScoring`: whether the covered events should affect future risk/accounting in this scope
- `effectiveFrom`: when the decision applies
- `expiresAt`: optional expiration for temporary overrides
- `reviewerId`: admin/reviewer identity
- `reviewerRole`: global admin, server owner, server admin, moderator, automated migration, etc.
- `rationale`: concise reviewer explanation
- `createdAt`: adjudication time

### `moderation_cases`

Human workflow container for grouping events, actions, appeals, notes, and adjudications.

Cases should support:

- global view for super admins
- server-scoped view for server admins
- subject history timeline
- linked detections and actions
- current effective standing
- action buttons such as dismiss, restrict, ban, reverse, mark false positive, mark test artifact, and exclude from future scoring

## Effective Standing

Trust/risk calculations should use an effective view, not raw event history.

Current recommendation:

- raw event history remains immutable
- each event has an effective adjudication state per relevant scope
- scoring excludes events where the latest applicable adjudication has `countsForScoring: false`
- global adjudications apply everywhere unless a narrower rule explicitly needs local context
- server adjudications apply only to that server scope
- model prompts and feature inputs should avoid presenting ignored detections as negative evidence
- when useful, prompts may include a compact neutral note such as `3 prior detections were adjudicated false-positive/test-artifact and excluded from scoring`

This avoids the failure mode where a user is repeatedly flagged for prior suspicious history after an authorized reviewer already corrected the record.

## Permission Model

Global admins can:

- view all moderation events and adjudications
- adjudicate global and server-scoped events
- reverse or override any automated action
- mark events as globally ignored for future scoring
- audit reviewer behavior

Server admins can:

- view events scoped to their server
- view limited global standing summaries when needed for safety decisions
- adjudicate server-scoped detections and actions
- mark server-local events as locally ignored for future scoring
- reverse server-local actions where the product grants that capability

Server admins cannot:

- erase global events
- modify another server's events
- globally clear a user's account standing
- hide their own reviewer actions from global audit

## Existing Data Migration

When this system is introduced, existing detections and actions should be backfilled into `moderation_events` instead of left as opaque legacy state.

Migration should preserve:

- original detection/action timestamps
- original confidence where available
- original reason text or normalized reason codes where available
- original actor/system source where available
- current action state, such as active ban or lifted ban
- a migration source marker when original provenance is incomplete

If old detections are known test artifacts, add adjudication records rather than deleting the migrated events.

## UI Requirements

Global admin console:

- subject search by user/account/profile/server
- global timeline of detections, actions, adjudications, and appeals
- effective standing summary with countable vs ignored signal breakdown
- filters for unresolved, active action, ignored, false positive, test artifact, and stale
- bulk adjudication for known test runs or duplicate imports
- reviewer/auditor activity log

Server admin console:

- server-local timeline for a subject
- local effective standing summary
- actions to dismiss, mark false positive, mark test artifact, restrict, ban, reverse, and open case
- clear labels when global intelligence exists but cannot be modified locally

Detection cards and alerts:

- show recent countable history separately from ignored/adjudicated history
- do not list ignored events as active reasons for suspicion
- expose a `History` path that explains why an alert triggered and what can be corrected

## Non-Goals For The First Slice

- building a giant Discord-sized permission matrix
- making AI the final judge of appeals or standing
- deleting historical detections as the normal correction path
- exposing private evidence across server boundaries without a need-to-know rule
- using broad natural-language heuristics in deterministic code to decide whether something is suspicious

## First Implementation Slice

1. Add immutable moderation events for detections and actions.
2. Add adjudication records with `countsForScoring` and scoped authority.
3. Update risk/history queries to return countable and ignored signal groups separately.
4. Update model/tool inputs to ignore non-countable prior detections as negative evidence.
5. Add global admin actions to mark events false-positive, test-artifact, policy-exempt, or ignored.
6. Add server admin actions for server-scoped false-positive/test-artifact/local-ignore decisions.
7. Backfill existing detections/actions into the event ledger.
8. Add tests that prove ignored historical detections no longer trigger recent-suspicious-history reasons.

## Open Questions

- Should global admins be able to mark a server-local event as globally ignored, or should that require promoting the event to global scope first?
- Should expired adjudications restore scoring automatically, or require re-review before counting again?
- Which evidence fields are safe for server admins to see when global intelligence contributed to a server-local alert?
- How should self-review be handled when the affected user is also a server admin or global admin?
