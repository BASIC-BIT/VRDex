# Cloud task startup

Use this guide in a managed VRDex cloud task. Read `AGENTS.md` and
[local development](local-development.md). The cloud environment prepares an
isolated checkout at `/workspace/VRDex`; use it directly. Processes from setup
must be restarted in each task.

The repository skill is `.agents/skills/vrdex-cloud-start/SKILL.md`. Discover it
through the supported skill catalog first. If it is missing from the catalog,
report that delivery gap and read the checked-in file by path. File access
proves a recovery route, not catalog discovery. An old
`/workspace/vrdex-start.md` capture is not the current Start field.

## Activate the prepared tools

Activate tooling in every shell. This selects repository-pinned pnpm and enables
system TLS certificates for Turbopack while preserving proxy and CA settings.

```bash
source /workspace/vrdex-env.sh
cd /workspace/VRDex
node --version
pnpm --version
```

Node must be version 24 and pnpm must match `package.json`. If an older published
activation helper omits system TLS support, explicitly export
`NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1` before `pnpm build:web`.
Preserve proxy/CA settings and TLS verification. A Google Fonts TLS error with
that flag absent is an activation gap, not a reason to change application fonts.

If the activation
file or required helpers are absent, report the incomplete published setup
before choosing a recovery route.

## Select the backend before starting services

Default to anonymous local development. Use hosted development or production
only when the task explicitly selects it. Install prepares dependencies,
browsers and credential-free helpers. Real Personal bindings are materialized
only at task startup, after publication.

### Hosted tasks

Inspect presence without printing values for `CONVEX_DEPLOYMENT_DEV`,
`CONVEX_DEPLOY_KEY_DEV`, `CONVEX_DEPLOYMENT_PROD`, `CONVEX_DEPLOY_KEY_PROD`,
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. Confirm the six
intended Personal bindings are available, then materialize them before starting
services:

```bash
node /workspace/.vrdex-tools/cloud-bindings/materialize-task-env.mjs --task-start /workspace/.vrdex-tools/cloud-bindings/vrdex-cloud-bindings.json /workspace/VRDex
```

Select `dev` or `prod` explicitly through `pnpm cx`. Both `pnpm cx dev ...` and
`pnpm cx -- dev ...` are supported by the wrapper. Follow
[Convex environments](../deployment/convex-environments.md) and
[Vercel previews](../deployment/vercel-preview.md) for hosted commands and
service configuration. Read-only health checks use:

```bash
pnpm cx dev run health:status
pnpm cx prod run health:status
```

Run only the selected target's check. Do not run anonymous preparation, seeding,
or local backend startup against a hosted deployment. Keep Personal bindings as
direct environment variables; proxy-secret compatibility is not established.
Provider writes follow the task's authorization.

### Local tasks

When refreshing functions or fixtures, stop any backend watcher you started,
then prepare the local deployment. The helper preserves `convex/README.md` and
exits its backend after bootstrap and seeding.

```bash
bash /workspace/.vrdex-tools/prepare-local.sh
```

Start the backend and web app in separate managed sessions, each with tooling
activated and `/workspace/VRDex` as its working directory:

```bash
pnpm dev:backend:local
```

```bash
pnpm dev:web
```

Verify `health:status` reports `ok` and `profiles:getPublicBySlug` returns
DJ Aurora for `playwright-dj-aurora` through the local backend. Check `/discovery`
and the seeded profile in the web app. Use loopback requests internally; use
supported preview links when presenting the app.

For focused browser validation, stop only the backend and web sessions you
started. Playwright starts its own servers. Avoid collisions on port 3210.

```bash
pnpm --filter web exec playwright test public-routes.smoke.spec.ts --project=desktop-chromium --workers=2 --grep '(home|discovery|search|person-profile|community-profile|world-profile|event-profile) renders'
```

## Verify task capabilities

Discover native GitHub, VRDex Public, Vercel, relevant provider tools and
Superpowers before first use. Report a missing native route before selecting a
recorded fallback. A proxy transport failure does not establish invalid
credentials. For shell requests denied at the sandbox boundary, use the
supported command permission mechanism while preserving proxy, CA and TLS.

Keep repository revision, published environment version, skill discovery,
prepared helpers, credential delivery and successful operations separate.
[The shared cloud recipes](https://github.com/BASIC-BIT/basic-infra/tree/main/services/cloud-environments)
record operator setup and acceptance evidence. Verify the active repository
skill and guide in a fresh task after each publication change. Private setup
uses `Only me` access and `All (unrestricted)` networking.

## Optional local Convex backend pin

`CONVEX_LOCAL_BACKEND_VERSION` is forwarded unchanged to the Convex CLI only for
`dev --local`. An explicit `--local-backend-version VALUE` or
`--local-backend-version=VALUE` takes precedence. An absent/empty environment
value adds no flag. Existing ports, noninteractive force-upgrade and environment
isolation remain in effect; force-upgrade alone does not choose a version.

The dated Task 9 verification pin is exactly
`precompiled-2026-09-28-5c7cb5b`. It is an execution input, not a repository default;
do not append `600`. Verify the isolated cache before ROOT's canonical local
workflow. The CLI may download missing artifacts or manage a dashboard, so this
setting is not an offline guarantee. Record the selected native backend version
and exit status independently. `pnpm check:backend:generated` starts a backend;
run canonical generation first and account for its reviewed generated diff.
The [migration rehearsal](./event-broadcast-rehearsal.md#october-24-2026-task-9-source-prerequisites)
requires its own isolated state and temporary local bindings.
