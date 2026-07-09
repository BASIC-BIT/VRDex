---
name: vrdex-manual-data-ops
description: Safely inspect, plan, apply, and verify manual VRDex Convex data changes before a first-class MCP/admin surface exists. Use for production or staging profile/event/world data fixes, consented demo profile creation, search-index readback, fixture-vs-live-data questions, and one-off operator data manipulation that must preserve provenance, public-surfacing rules, and auditability.
---

# VRDex Manual Data Ops

This is the Codex wrapper for the repo source skill:

- `.opencode/skills/vrdex-manual-data-ops/SKILL.md`

Read that source skill before manually inspecting or changing VRDex data in
Convex, especially production/staging records, consented demo profiles, lookup
demo cohorts, or search-index readback.

Codex translation notes:

- Use MCP tools when an approved VRDex data MCP exists; until then, use the
  documented Convex CLI/script fallback.
- Treat Playwright fixtures as deterministic local dummy data, not production
  database records.
- For production writes, verify the target deployment and ask for explicit
  approval before mutating data.
