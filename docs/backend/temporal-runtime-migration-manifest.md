# Temporal Runtime Migration Manifest

- Source repository: `BASIC-BIT/discord-time-app`
- Source commit: `c9cb787aec31c14ddff3e70030deeddb40004c3c`
- Migrated: 2026-07-21

The following files were copied without semantic changes into
`packages/temporal-runtime/src`:

| VRDex file | Source file |
| --- | --- |
| `types.ts` | `api/src/temporal/types.ts` |
| `plan-ir.ts` | `api/src/temporal/plan-ir.ts` |
| `deterministic.ts` | `api/src/temporal/deterministic.ts` |
| `timezones.ts` | `api/src/temporal/timezones.ts` |
| `tools.ts` | `api/src/temporal/tools.ts` |
| `graph.ts` | `api/src/temporal/graph.ts` |
| `index.ts` | `api/src/temporal/index.ts` |

VRDex adds `kind: "instant"` to validated singular responses because the public
discriminated union requires an explicit kind. The source response type allowed
the field, but its singular response builder omitted it. This is an
upstream-candidate compatibility fix, not a parsing-policy change.

VRDex narrows the imported graph through its public API and provider adapter.
The package intentionally preserves the proven Plan-IR and deterministic
execution behavior during the ownership handoff. Historical general-LLM paths
remain internal implementation code; callers cannot select them, provide model
credentials, alter prompts, or access a general completion endpoint.

The training code, datasets, historical benchmark material, and desktop client
remain in `discord-time-app`. Future VRDex changes to these migrated files must
update this manifest and the executor-backed promotion evidence.

The adapter artifact is not committed. Deployment verifies the release SHA-256
`d933bd524bbf95a4521f243a61cdf3e196fea08133d00fd4a72e0db30160e598`
before moving it into an organization-owned model store. Resolve the missing
root license-file issue before publishing code or model artifacts publicly.
