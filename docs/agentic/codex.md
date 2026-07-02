# Codex Notes

VRDex has historically used OpenCode for long-running local agent work. Codex
should reuse the same durable playbooks while mapping OpenCode-specific tools to
Codex capabilities.

## Startup Context

- Read `AGENTS.md` first, and `AGENTS.local.md` when present.
- Use `docs/agentic/README.md` for the core software-factory docs.
- Use `.codex/skills/*/SKILL.md` as thin Codex entry points when repo-local
  skills are available.
- Do not work directly in the protected `main` mirror except for explicitly
  requested mirror maintenance.

## Worktree Policy

Current local convention:

- Protected main mirror: `D:/bench/VRDex`
- Active worktree root: `D:/bench/VRDex-wt`
- Feature worktrees: `D:/bench/VRDex-wt/<name>`

The protected mirror should stay on `main` and clean. Routine implementation,
review recycle work, and Codex parity changes should happen in named worktrees
under `D:/bench/VRDex-wt`.

The root package scripts run `scripts/guard-main-worktree.mjs` before local
development, build, lint, test, and verification commands. The guard blocks
those commands on `main` unless one of these is true:

- CI is running.
- `GITHUB_ACTIONS=true` is set.
- `VRDEX_ALLOW_PROTECTED_WORKTREE=1` is set for intentional mirror maintenance.

## Skills

The OpenCode source skills live under `.opencode/skills/<name>/SKILL.md`.

Codex wrappers live under `.codex/skills/<name>/SKILL.md`. Each wrapper keeps
Codex-valid frontmatter and points back to the OpenCode source skill. If a
Codex session does not auto-discover repo-local skills, open the wrapper or
source skill by path.

Current wrappers:

- `vrcdn`
- `vrdex-onboarding`

Keep `.opencode/skills` as the detailed source of truth. Keep `.codex/skills`
as thin compatibility shims, not duplicated long playbooks.

## Tool Mapping

- OpenCode plugins under `.opencode/plugins` are not Codex tools unless the
  active Codex tool list explicitly exposes equivalent functions.
- The OpenCode `/supervisor` command and `.opencode/plugins/supervisor-loop.*`
  remain OpenCode experiments. In Codex, use thread coordination tools only when
  they are explicitly available in the active tool list.
- For GitHub and PR review loops, prefer a GitHub connector when available;
  otherwise use `gh` and manual polling.
- For frontend verification, use the Codex Browser plugin for local targets when
  available, plus screenshot evidence for meaningful UI changes.
- For library, SDK, CLI, and cloud-service docs, use Codex documentation tools
  such as Context7 when available, or primary-source web docs when required.
- For reminders, monitors, or later follow-ups, use Codex automations only when
  the user asks for that behavior.

## MCP Config

Codex project MCP config lives at `.codex/config.toml` and mirrors the OpenCode
`.opencode/opencode.json` servers:

- `playwright`
- `vercel_vrdex`
- `convex`
- `aws_docs`
- `aws_iac`
- `aws_terraform`
- `aws_mcp`
- `daytona`

These are project-scoped VRDex servers. Keep them in repo-local config rather
than relying on global Codex config inheritance. Global Codex MCP entries should
be reserved for genuinely cross-repo tools.

Project MCP commands should be PATH-resolved where possible. Personal absolute
paths, account-specific environment variables, and machine-local command paths
belong in local or global Codex config, not committed project config.

If an MCP server is not active in the current Codex session, use the documented
CLI fallback (`vercel`, `aws`, `npx convex`, `gh`) or report the missing
capability. Production data, infrastructure, billing, or secret mutations still
require the normal approval and escalation workflow.
