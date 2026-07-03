---
name: vrcdn
description: Work with VRCDN provider setup, URL formats, smoke tests, and VRDex restream POC flows without leaking stream credentials.
---

# VRCDN

This is the Codex wrapper for the repo source skill:

- `.opencode/skills/vrcdn/SKILL.md`

Read that source skill before working on VRCDN provider setup, smoke tests, URL
handling, or restream POC diagnosis. Treat it as the source of truth for safety
boundaries and validation commands.

Codex translation notes:

- Use Codex MCP tools when available; otherwise use the documented CLI fallback.
- Never print, commit, or paste stream keys, provider passwords, combined ingest
  URLs, signed URLs, or copied provider secrets.
- Report only public preview/playback URLs when they contain no credential
  material, plus secret names, task IDs, sanitized event names, and status.
