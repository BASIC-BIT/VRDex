# OpenCode Adapter For The Portable VRDex Skill

## Reference Pattern

External repos that use OpenCode can reference the portable VRDex skill by copying or vendoring `skills/vrdex/` into their repo, then adding a short pointer in their local agent guidance:

```md
When integrating with VRDex, load or read `skills/vrdex/SKILL.md` first. Treat it as product integration guidance, not private maintainer onboarding.
```

## Keep Separate From Maintainer Onboarding

Do not copy `.opencode/skills/vrdex-onboarding/` into partner repos. That skill is for maintainers working inside the VRDex repo.

## Public Data Only

Partner agents should use the portable skill with public docs, public API routes, and future public MCP tools. They should not depend on BASIC BIT secrets, local Convex deployments, Vercel project IDs, or private partner notes.
