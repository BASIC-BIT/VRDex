# OpenCode Adapter For The VRDex Partner Agent Skill

## Reference Pattern

External repos that use OpenCode can reference the portable VRDex skill by adding a short pointer in their local agent guidance:

```md
When integrating with VRDex, read the VRDex partner-agent guidance first. Treat it as public product integration guidance, not private maintainer onboarding.
```

Canonical guidance lives in [VRDex Partner Agent Skill](./partner-agent-skill.md).

## Install / Reference Options

- Preferred: add a short local `AGENTS.md` or project instruction that links to the canonical VRDex partner-agent guidance.
- Compatibility mode: vendor `skills/vrdex/SKILL.md` when the agent tool expects a skill file, but keep that file pointer-heavy.
- Do not vendor `.opencode/skills/vrdex-onboarding/`; that skill is maintainer onboarding for this repo, not partner integration guidance.
- If a partner repo vendors a copy, refresh it when the public API, MCP, trust labels, or seed-import docs change.

## Keep Separate From Maintainer Onboarding

Do not copy `.opencode/skills/vrdex-onboarding/` into partner repos. That skill is for maintainers working inside the VRDex repo.

## Public Data Only

Partner agents should use the portable skill with public docs, public API routes from [#39](https://github.com/BASIC-BIT/VRDex/issues/39), and public MCP tools when the [#78](https://github.com/BASIC-BIT/VRDex/issues/78) prototype lands. They should not depend on BASIC BIT secrets, local Convex deployments, Vercel project IDs, or private partner notes.
