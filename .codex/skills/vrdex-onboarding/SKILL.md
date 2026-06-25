---
name: vrdex-onboarding
description: Onboard a new Codex agent or maintainer to VRDex's repo structure, software-factory posture, and local-vs-global context model.
---

# VRDex Onboarding

This is the Codex wrapper for the repo source skill:

- `.opencode/skills/vrdex-onboarding/SKILL.md`

Read that source skill before onboarding a new agent or maintainer. Treat it as
the source of truth for repo orientation.

Codex translation notes:

- Read `AGENTS.md` first, then `AGENTS.local.md` when present.
- Use `docs/agentic/codex.md` for Codex-specific MCP, skill, and worktree notes.
- Keep `.opencode/skills` as the detailed source of truth and keep this wrapper thin.
- Do not work directly in the protected `main` mirror except for explicitly
  requested mirror maintenance.
