---
name: vrdex-manual-profile-ops
description: Safely perform manual VRDex profile data operations before durable admin/MCP tooling exists, including consented concierge profile creation or correction, bios, aliases, genres, links, public surfacing, avatars, profile images, media-kit assets, and production Convex/S3 operator workflows.
---

# VRDex Manual Profile Ops

This is the Codex wrapper for the repo source skill:

- `.opencode/skills/vrdex-manual-profile-ops/SKILL.md`

Read that source skill before manually creating, correcting, or enriching
profile data through Convex, S3, or temporary operator workflows. Treat it as
the source of truth for safety boundaries and closeout checks.

Codex translation notes:

- Do not print, commit, or paste deploy keys, upload tokens, Discord IDs,
  private image files, or one-off profile payloads.
- Use temporary Convex operator code only when product/admin mutations are not
  enough, then remove it and redeploy clean after verification.
- Production profile, asset, IAM, billing, and provider mutations still require
  the normal explicit approval and escalation workflow.
