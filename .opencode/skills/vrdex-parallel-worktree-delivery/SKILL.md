---
name: vrdex-parallel-worktree-delivery
description: Use for VRDex implementation programs that should run multiple local worktrees or parallel agents before one integrated PR.
compatibility: opencode
metadata:
  audience: maintainers
  domain: agentic-delivery
---

## Goal

Run a coordinated local worktree fanout/converge workflow without losing
quality, safety, or final integration discipline.

## Read First

- `AGENTS.md`
- `docs/agentic/parallel-worktree-delivery.md`
- `docs/agentic/feature-design-loop.md`
- relevant planning docs under `docs/planning/`

## Workflow

1. Confirm the root contract and issue tree before fanout.
2. Create kickoff packets for each leaf worktree.
3. Use `D:\bench\VRDex-wt\<program>-<slice>` worktrees and local branches.
4. Keep leaf agents scoped to their worktree and verification commands.
5. Merge or cherry-pick leaves into a local integration branch in dependency
   order.
6. Run integrated checks after each accepted leaf.
7. Use fresh-context review before opening a public PR.
8. Promote the workflow globally only after a human gate and evidence that it
   worked.

## Guardrails

- Do not fan out before shared contracts are stable enough.
- Do not store secrets in shared state, kickoff packets, logs, or docs.
- Do not push, open PRs, deploy, trigger paid reviews, or mutate provider
  settings from leaf sessions unless explicitly approved.
- Do not let `.opencode/state/` become the only source of truth for durable
  decisions.
- Stop and consolidate if leaves drift, duplicate work, or create repeated
  conflicts.

## Outputs

- integration branch with locally merged leaf work
- concise merge log
- verification results for each leaf and integrated state
- updated docs for behavior and workflow changes
- promotion note if the workflow should become shared beyond VRDex
