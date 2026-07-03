---
name: vrdex-parallel-worktree-delivery
description: Use for VRDex implementation programs that should run multiple local worktrees or parallel agents before one integrated PR.
---

# VRDex Parallel Worktree Delivery

This is the Codex wrapper for the repo source skill:

- `.opencode/skills/vrdex-parallel-worktree-delivery/SKILL.md`

Read that source skill before coordinating parallel VRDex worktrees or agent
fanout. Treat it as the source of truth for scope, guardrails, and expected
outputs.

Codex translation notes:

- Use Codex thread, tool, or connector capabilities only when they are explicitly
  available in the active session.
- Keep implementation work in the assigned worktree and preserve the protected
  `main` mirror.
- Do not push, open PRs, deploy, trigger paid reviews, or mutate provider
  settings unless the human explicitly approves that step.
