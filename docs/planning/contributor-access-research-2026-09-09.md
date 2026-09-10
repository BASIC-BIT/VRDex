# Contributor access research: cloud-scoped vs fully-local development

Research date: 2026-09-09. Status: facts gathered from vendor documentation only. No recommendation, no
configuration changed, no keys created. Primary sources only (Convex, Vercel, GitHub, Clerk official docs and
pricing pages). Every claim is followed by the page that owns it.

Scope: what the platforms actually permit for outside contributors on a Next.js (Vercel) + Convex + Clerk project
in a single-owner GitHub repo. Two models were investigated but not compared or scored here: (A) scoped cloud
access — contributor pushes Vercel preview deployments and reads a shared dev Convex deployment; (B) fully-local
development — local Convex backend plus seeded data, no cloud account.

## 1. Convex team membership, roles, and seats

Convex has two built-in team roles, Admin and Developer, plus a project-scoped Project Admin role.

A Developer can "Create new projects and deployments", "View existing projects, and create development and preview
deployments for these projects", and "View the team's usage and billing status (such as previous and upcoming
invoices)". Critically for a shared-cloud model: "Developers may read data from production deployments, but cannot
write to them."
[Convex teams documentation](https://docs.convex.dev/dashboard/teams)

An Admin can do everything a Developer can, plus invite and remove team members, change other members' roles,
manage the subscription and billing details, and change the team name, slug, and default region. "Team Admins are
also implicitly granted project admin access to all projects within the team."
[Convex teams documentation](https://docs.convex.dev/dashboard/teams)

Project Admin is granted per project (automatically to the creator of a project) and adds the ability to update the
project name and slug, update the project's default environment variables, delete the project, and write to
production deployments.
[Convex teams documentation](https://docs.convex.dev/dashboard/teams)

Restriction of a member to one project: members are invited at the **team** level, and the built-in Developer role
grants visibility of existing projects across the team. There is no documented built-in mechanism to scope a member
to a single project; the only project-scoped grant documented is Project Admin, which *adds* permissions rather than
removing them. Fine-grained scoping is described as a Business-tier feature: custom roles with fine-grained
permissions.
[Convex teams documentation](https://docs.convex.dev/dashboard/teams)

Restriction to non-production deployments: partially available by role. A Developer cannot write to production, but
the same page states a Developer may **read** production data. So "developer" is not equivalent to "cannot see
production data".
[Convex teams documentation](https://docs.convex.dev/dashboard/teams)

Plan and seat facts as published in 2026:

- Free and Starter: "Free or $0/month and pay as you go", 1-6 developers, preview deployments included, no log
  streaming and no custom domains.
  [Convex pricing](https://www.convex.dev/pricing)
- Professional: "$25 per developer/month", 1-20 developers, adds log streaming, custom domains, exception
  reporting, and daily backups.
  [Convex pricing](https://www.convex.dev/pricing)
- Business/Enterprise: "$2,500 monthly minimum", 50+ members, adds SAML/SSO and dedicated deployments; no
  per-developer price is quoted.
  [Convex pricing](https://www.convex.dev/pricing)

Deployment count is also plan-limited: 40 deployments per team on Free/Starter, 300 on Professional, unlimited on
Business/Enterprise. Every deployment created — including previews — counts against that limit.
[Convex limits](https://docs.convex.dev/production/state/limits),
[Convex preview deployments](https://docs.convex.dev/production/hosting/preview-deployments)

Billing language confirms seats are per developer: the teams page refers to "seat fees (the amount paid for each
developer in your team)".
[Convex teams documentation](https://docs.convex.dev/dashboard/teams)

## 2. Per-developer dev deployments

Convex documents the deployment topology explicitly: "A project has one production deployment, up to one cloud
deployment for development per team member, and potentially many transient preview deployments."
[Convex local deployments](https://docs.convex.dev/cli/local-deployments)

Data is **not** shared across those deployments: "Each Convex deployment contains its own data, functions, scheduled
functions, etc."
[Convex local deployments](https://docs.convex.dev/cli/local-deployments)

In the dashboard these appear as distinct entries — `production`, `dev/<your name>`, `preview/<branch>` — selectable
from the deployment picker.
[Convex deployments dashboard](https://docs.convex.dev/dashboard/deployments)

Consequence for model (A): there is no documented "shared dev database" primitive. A personal cloud dev deployment
is per member and privately seeded; sharing one dataset between contributors means either pointing them all at one
deployment's credentials or re-seeding each deployment from an export (see section 6).

`npx convex dev` targets your dev deployment and prompts for login on first run to create a project.
[Convex CLI reference](https://docs.convex.dev/cli)

That login requirement has an escape hatch. In anonymous/agent mode the CLI provisions a local backend instead:
"when no deployment is already configured and `CONVEX_DEPLOY_KEY` isn't set, the CLI defaults to provisioning a local
deployment automatically", and in non-interactive shells "`npx convex` will never prompt the agent to log in".
[Convex agent mode](https://docs.convex.dev/cli/agent-mode)

So: a cloud dev deployment inside someone else's project requires team membership (the Developer role is what grants
"create development and preview deployments for these projects"), while a local deployment requires no account at
all.
[Convex teams documentation](https://docs.convex.dev/dashboard/teams),
[Convex local deployments](https://docs.convex.dev/cli/local-deployments)

## 3. Convex preview deployments

Mechanism: a preview deploy key is generated on the project's dashboard settings page and supplied as
`CONVEX_DEPLOY_KEY`. Preview deploy keys have the form `preview:team-slug:project-slug|eyJ2...0=` and "modify
standard `npx convex deploy` behavior to direct code to preview branches rather than main production systems".
[Convex deploy key types](https://docs.convex.dev/cli/deploy-key-types)

Commands: `npx convex deploy --preview-name="my-preview-deployment-name"` creates or reuses a preview deployment by
name; `npx convex deploy --preview-create="name"` deletes and recreates it on every deploy; `--preview-run=<functionName>`
runs a Convex function against the freshly created deployment to seed sample data. If the seeding function fails,
the deployment is still provisioned but the deploy command fails.
[Convex preview deployments](https://docs.convex.dev/production/hosting/preview-deployments)

CI integration: "When deploying from Vercel, Netlify, Cloudflare Pages, or GitHub Actions, you can simply run
`npx convex deploy` and the preview name is determined automatically."
[Convex preview deployments](https://docs.convex.dev/production/hosting/preview-deployments)

Vercel wiring specifically: override the build command to `npx convex deploy --cmd 'npm run build'`, and create the
`CONVEX_DEPLOY_KEY` environment variable in Vercel scoped to the **Preview** environment only (production and other
environments unchecked). "`npx convex deploy` will read `CONVEX_DEPLOY_KEY` from the environment, and use it to
create a Convex deployment associated with the Git branch name". Seeding is added by appending
`--preview-run 'functionName'` to the build command.
[Convex on Vercel](https://docs.convex.dev/production/hosting/vercel)

Plan requirement and lifetime: preview deployments are listed on Free & Starter and above, and the feature is in
beta. They are cleaned up automatically after "5 days (Free and Starter plans)" or "14 days (Professional, Business,
and Enterprise plans)", and each one counts against the team's deployment limit.
[Convex pricing](https://www.convex.dev/pricing),
[Convex preview deployments](https://docs.convex.dev/production/hosting/preview-deployments)

Seeding a preview from a real dataset is also documented as an import step rather than a function call — the import
docs give a Vercel example that runs `npx convex import --preview-name "$VERCEL_GIT_COMMIT_REF" seed_data.zip` when
`VERCEL_ENV` is `preview`.
[Convex data import](https://docs.convex.dev/database/import-export/import)

On handing a preview deploy key to CI that runs fork PRs, the documentation supports these facts rather than a
verdict:

- The key is project-scoped (`preview:team-slug:project-slug`), and Convex's guidance for handing deployments to
  agents or CI jobs is to create keys "scoped just to it"; deploy keys belong in the CI provider's secret store, not
  in the repository.
  [Convex deploy key types](https://docs.convex.dev/cli/deploy-key-types)
- The key's capability is creating and deploying arbitrary Convex functions into preview deployments of that
  project, and preview deployments consume the team's deployment quota.
  [Convex preview deployments](https://docs.convex.dev/production/hosting/preview-deployments)
- GitHub does not expose repository secrets to `pull_request`-triggered workflows from forks in the first place
  (section 8), so a fork-PR workflow cannot read `CONVEX_DEPLOY_KEY` unless the workflow is deliberately switched to
  a privileged trigger, which GitHub warns against (section 8).
  [GitHub events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

## 4. Local Convex backend

Current state: local deployments are a documented, in-beta feature. "Instead of syncing code to a Convex dev
deployment hosted in the cloud, you can develop against a deployment running on your own computer. You can even use
the Convex dashboard with local deployments!" Selection is via `npx convex deployment select local`, and
`npx convex deployment select dev` switches back to the personal cloud dev deployment.
[Convex local deployments](https://docs.convex.dev/cli/local-deployments)

Account requirement: none. "You can use local deployments to develop with Convex without having to create an
account. Whenever you want to create an account to deploy your app to production or to use more Convex features, you
can use `npx convex login` to link your local deployments with your account." Agent/CI shells can force this with
`CONVEX_AGENT_MODE=anonymous`, which also enables `npx convex init` to initialise a deployment before pushing code.
[Convex local deployments](https://docs.convex.dev/cli/local-deployments),
[Convex agent mode](https://docs.convex.dev/cli/agent-mode)

Process model and persistence: "the local Convex backend runs as a subprocess of the `npx convex dev` command and
exits when that command is stopped", which means a `convex dev` must be running for `npx convex run` or a frontend to
reach it. "State for local backends is stored in a `.convex` directory in your project."
[Convex local deployments](https://docs.convex.dev/cli/local-deployments)

Documented limitations:

- **No public URL.** Local deployments listen on your own computer, so inbound HTTP from services like Twilio does
  not work, and you cannot power a website with Convex WebSocket connections that users' browsers must reach. The
  docs suggest a proxy such as ngrok or a cloud deployment for those cases.
- **Node actions need a matching Node.js version.** Actions in files marked `"use node;"` require the same Node.js
  version the project is configured for, by default Node.js 20.
- **Node.js actions run directly on your machine** with unrestricted filesystem access; queries, mutations, and
  Convex-runtime actions still run isolated.
- **Logs are cleared** every time `npx convex dev` restarts.
- **Browser caveats**: Safari blocks localhost requests, preventing the dashboard from working with local
  deployments; Brave blocks them by default and needs the `#brave-localhost-access-permission` flag plus a
  per-site "Localhost access: Allow" setting.
- Not recommended for production, because development deployments send function-result logs and full stack traces
  to connected clients.

[Convex local deployments](https://docs.convex.dev/cli/local-deployments)

Feature-by-feature gaps: the local-deployments page does not enumerate file storage, scheduled functions, vector
search, auth, or components as unsupported. The nearest documented statements are (a) the limitation list above,
which is about URLs, Node versions, isolation, logs, and browsers rather than product features, and (b) the agent
mode page, which says local backends suit "ephemeral agents that don't require webhooks or default environment
variables" and are not suitable for agents needing "crons, or integrations that aren't available locally".
[Convex local deployments](https://docs.convex.dev/cli/local-deployments),
[Convex agent mode](https://docs.convex.dev/cli/agent-mode)

Windows support: not stated either way on the local-deployments page. See "Unknowns" below.

Export/import against a local deployment: the CLI's import/export commands target the currently selected deployment,
and `npx convex deployment select local` makes the local backend the current deployment; the import documentation's
first listed use case is "Seed dev deployments with sample data" via `npx convex import seed_data.zip`. The docs do
not contain an explicit sentence confirming export/import with a local backend, so treat this as inferred from the
deployment-selection model rather than stated.
[Convex local deployments](https://docs.convex.dev/cli/local-deployments),
[Convex data import](https://docs.convex.dev/database/import-export/import)

Self-hosting is a separate, documented path from local dev: "you can self-host a production deployment using the open
source convex-backend repo", and self-hosted Convex "supports all the free-tier features of the cloud-hosted
product".
[Convex local deployments](https://docs.convex.dev/cli/local-deployments),
[Convex self-hosting guide](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md)

## 5. Auth (Clerk or Convex Auth) against a local backend

Convex's Clerk integration is configured server-side in `auth.config.ts` with a `domain` (the Clerk Frontend API
issuer URL, `https://verb-noun-00.clerk.accounts.dev` in development, `https://clerk.<your-domain>.com` in
production) and `applicationID: "convex"`, with the domain typically supplied through a `CLERK_JWT_ISSUER_DOMAIN`
environment variable. The configuration reaches the backend only when it is synced: "you must run `npx convex dev` or
`npx convex deploy` after adding a new provider to sync the configuration to your backend" — `npx convex dev` is the
command that runs the local backend, so the same sync step applies there.
[Convex + Clerk](https://docs.convex.dev/auth/clerk)

Convex's auth model is provider-agnostic by design: Convex accepts OpenID Connect ID tokens in JWT form, which any
service implementing the appropriate OAuth endpoints can issue.
[Convex authentication overview](https://docs.convex.dev/auth)

Convex Auth (the `@convex-dev/auth` library) is installed with `npm install @convex-dev/auth @auth/core@0.41.1` and
initialised with `npx @convex-dev/auth`, adding `authTables` to the schema and swapping `ConvexProvider` for
`ConvexAuthProvider`. Its callback handling depends on a `SITE_URL` deployment environment variable pointing at the
frontend origin (set for local development with `npx convex env set SITE_URL http://localhost:5173`, port adjusted).
[Convex Auth setup](https://labs.convex.dev/auth/setup),
[Convex Auth manual setup](https://labs.convex.dev/auth/setup/manual)

The one structural caveat that the local-deployment docs do impose on any auth flow: a local backend has no public
URL, so any provider callback or webhook that must reach the Convex backend from the internet needs a proxy.
[Convex local deployments](https://docs.convex.dev/cli/local-deployments)

## 6. Sharing data: export, import, and a local dashboard

Export: "You can export your data to a zip file from Convex by taking a backup and downloading it. Alternatively, you
can export the same data with the command line: `npx convex export --path ~/Downloads`". A streaming/paginated export
path exists via the Data Sync API or third-party integrations.
[Convex data export](https://docs.convex.dev/database/import-export/export)

Import: `npx convex import <path>.zip` restores a backup ZIP into a deployment; "Documents will retain their `_id` and
`_creationTime` fields so references between tables are maintained." Per-table import is
`npx convex import --table <tableName> <path>` for CSV, JSON, or JSONLines. "The default is to import into your dev
deployment. Use `--prod` to import to your production deployment or `--preview-name` to import into a preview
deployment."
[Convex data import](https://docs.convex.dev/database/import-export/import)

Format and size constraints worth knowing before shipping a seed file:

- `.csv` files must have a header, and cells are read as a float or a string; `.jsonl` needs one JSON object per
  line; `.json` must be an array of objects.
- "JSON arrays have a size limit of 8MiB. To import more data, use CSV or JSONLines."
- ZIP imports can carry Convex-specific types (Int64, Bytes) preserved through `generated_schema.jsonl`; JSON and
  JSONL cannot.
- ZIP exports that include file storage import the files and preserve `_storage` documents with their `_id`,
  `_creationTime`, and `contentType`.
- Imports into a table with existing data fail by default; `--append` or `--replace` are required.
- Imports are atomic per table (except `--append`), so queries never observe a partial import.
- "Data import is not always supported when importing into a deployment that was created before Convex version 1.7."
- Import consumes database bandwidth (and file bandwidth when file storage is included), metered as `_cli/import`.
- Manual edits to the ZIP between export and import are undocumented and discouraged.

[Convex data import](https://docs.convex.dev/database/import-export/import)

Dashboard against a local backend: "You can use local deployments with an existing Convex project, and view your
deployment in the Convex dashboard under your project. You can also use local deployments without a Convex account
and debug and inspect them with a locally running version of the Convex dashboard." Safari and Brave block localhost
requests and break this (section 4).
[Convex local deployments](https://docs.convex.dev/cli/local-deployments)

Self-hosted dashboard image: the self-hosting guide runs two Docker services — a backend on `http://127.0.0.1:3210`
(with HTTP actions on `:3211`) and a dashboard on `http://localhost:6791`. Credentials come from
`docker compose exec backend ./generate_admin_key.sh`, and the CLI is pointed at it by setting
`CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` in `.env.local`, after which `npx convex dev` and other
`npx convex` commands operate against that backend.
[Convex self-hosting guide](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md)

## 7. Vercel: fork PRs, preview deployments, and seats

Default behaviour: "Vercel for GitHub will **deploy every push by default**. This includes pushes and pull requests
made to branches." Each PR's latest push gets a unique preview URL, posted as a PR comment.
[Vercel for GitHub](https://vercel.com/docs/git/vercel-for-github)

Forks are the exception. "If you receive a pull request from a fork of your repository, Vercel will require
authorization from you or a team member to deploy the pull request. This behavior protects you from leaking
sensitive project information such as environment variables and the OIDC Token. You can disable Git Fork Protection
in the Security section of your Project Settings."
[Vercel for GitHub](https://vercel.com/docs/git/vercel-for-github)

That sentence is the whole exposure story: a fork preview build runs the fork's code with the project's **Preview**
environment variables and, when enabled, the Vercel OIDC token, which is why authorization is required and why
disabling Git Fork Protection is described as removing that protection.
[Vercel for GitHub](https://vercel.com/docs/git/vercel-for-github)

Preview environment variables are per-environment and can additionally be scoped per branch: "Branch-specific values
override Preview variables with the same name", which is the documented way to give one branch different values from
the general Preview set.
[Vercel environments](https://vercel.com/docs/deployments/environments)

Preview URLs are not public-by-default if Deployment Protection is on: Standard Protection "protects all deployments
**except** production domains" and is available on all plans, using Vercel Authentication (access limited to Vercel
users with suitable access rights). Deployment Protection has been enabled by default for new projects.
[Vercel Deployment Protection](https://vercel.com/docs/deployment-protection)

CLI deploys by a non-team-member: the CLI's own flow requires selecting a team and linking a project ("? Which team?
My Awesome Team"), so a CLI deployment is made in the context of a team the acting account has access to.
[Vercel project linking](https://vercel.com/docs/cli/project-linking)

Seat costs for adding a contributor:

- Hobby is not a collaboration plan: "Team collaboration features" are listed as Pro-only, RBAC is marked `N/A` on
  Hobby, and the fair-use guidelines restrict Hobby "to non-commercial, personal use only".
  [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- On upgrade, "Developer seats cost **$20 per user / month**, while Viewer seats are free."
  [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- Role shapes relevant to an outside contributor: **Developer** (team-level) can create deployments and control
  environment variables "particularly for preview and development environments", but is "restricted from altering
  production environment variables and team-specific settings" — while still able to "deploy to production by
  merging to the production branch in Git-based workflows". **Contributor** is the only role that can be scoped per
  project: "Contributors have no access to projects unless explicitly assigned", and only contributors can hold the
  project-level roles (Project Administrator, Project Developer, Project Viewer). **Pro Viewer** is read-only, can
  comment on preview deployments, and "Pro Viewer seats are provided free of charge on Pro teams".
  [Vercel access roles](https://vercel.com/docs/rbac/access-roles)
- Note the Project Viewer role can "Examine environment variables across all environments", so a read-only project
  grant is not the same as hiding secrets.
  [Vercel access roles](https://vercel.com/docs/rbac/access-roles)

## 8. GitHub Actions: fork PR triggers, secrets, and approval

Secrets on fork PRs: "With the exception of `GITHUB_TOKEN`, secrets are not passed to the runner when a workflow is
triggered from a forked repository. The `GITHUB_TOKEN` has read-only permissions in pull requests from forked
repositories."
[GitHub events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

Also on that page: "Workflows don't run in forked repositories by default. You must enable GitHub Actions in the
**Actions** tab of the forked repository", and "When a first-time contributor submits a pull request to a public
repository, a maintainer with write access may need to approve running workflows on the pull request."
[GitHub events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

`pull_request_target` runs "in the context of the default branch of the base repository, rather than in the context
of the merge commit, as the `pull_request` event does", which is what makes secrets available — and dangerous:
"Running untrusted code on the `pull_request_target` trigger may lead to security vulnerabilities. These
vulnerabilities include cache poisoning and granting unintended access to write privileges or secrets." The docs add
"Avoid using this event if you need to build or run code from the pull request."
[GitHub events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

The security-hardening guidance repeats it: "The `pull_request_target` and `workflow_run` workflow triggers, when
used with the checkout of an untrusted pull request, expose the repository to security compromises"; such workflows
are "privileged", sharing the main-branch cache and potentially holding write access and referenced secrets;
"Workflows that use these triggers must not explicitly check out untrusted code, including from pull request forks."
[GitHub Actions secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)

Workflow approval settings for fork PRs, configurable at repository, organization, and enterprise level, with "all
first-time contributors require approval to run workflows" as the default:

1. "Require approval for first-time contributors who are new to GitHub" — approval only for users new to GitHub with
   no prior merged commits or pull requests in the repository.
2. "Require approval for first-time contributors" — approval for users who have never had a commit or pull request
   merged into the repository.
3. "Require approval for all external contributors" — approval for any user who is not a member or owner of the
   repository or an organization member.

[GitHub Actions repository settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)

## 9. Clerk: sharing a development instance

Clerk separates instances by environment. The development instance is intended for "local development" and has "a
more relaxed security posture", signalled by a dashboard banner, prefixed email/SMS templates, and shared social
credentials specifically so it is not mistaken for production.
[Clerk environments](https://clerk.com/docs/deployments/environments)

Key semantics: the Publishable Key "will be prefixed with `pk_test_` in development instances and `pk_live_` in
production instances", and the Secret Key "will be prefixed with `sk_test_` in development instances and `sk_live_`
in production instances" with the explicit instruction "**Do not expose this on the frontend with a public
environment variable**".
[Clerk environment variables](https://clerk.com/docs/guides/development/clerk-environment-variables)

Clerk states the publishable key is safe to expose on the frontend and does not need rotating if it becomes public;
the secret key must be kept private, and development and production instances are independent — rotating the
production secret key does not affect the development one, and vice versa.
[Clerk API key rotation](https://clerk.com/docs/guides/secure/rotate-api-keys)

Localhost: development instances are built for it. Because the frontend runs on localhost while Clerk's API is on an
`accounts.dev` domain, sessions are carried by a "dev browser" value in a querystring parameter (`__clerk_db_jwt`)
rather than cookies, and this querystring mechanism "is not secure enough for production use" since the value can
appear in logs and browser history. Development instances are restricted to `accounts.dev` domains and are not
indexed by search engines.
[Clerk environments](https://clerk.com/docs/deployments/environments)

Per-instance user cap: "Development instances are capped at 100 users, and user data can not be transferred between
instances."
[Clerk environments](https://clerk.com/docs/deployments/environments)

Clerk publishes no statement that a dev-instance **secret** key is safe to hand to third parties; what it publishes
is that the secret key must never reach the frontend, that dev instances have a deliberately relaxed security
posture, and that dev and prod key material are independent. Anyone holding a dev secret key can act as the backend
of that dev instance, including over its (capped) user records.
[Clerk environment variables](https://clerk.com/docs/guides/development/clerk-environment-variables),
[Clerk environments](https://clerk.com/docs/deployments/environments)

## Unknowns / could not verify

- **Convex dashboard visibility of production environment variables for the Developer role.** The teams page says
  Developers may read production data and that updating a *project's default* environment variables is a Project
  Admin power, but it does not say whether a plain Developer can *view* a production deployment's environment
  variable values in the dashboard. Not stated on
  [Convex teams documentation](https://docs.convex.dev/dashboard/teams).
- **Windows support for `npx convex dev --local`.** The local-deployments page lists limitations (no public URL,
  Node version, filesystem access, logs, Safari/Brave) but makes no platform statement, and no other primary page
  found addresses Windows explicitly.
  [Convex local deployments](https://docs.convex.dev/cli/local-deployments)
- **Explicit confirmation that `npx convex export`/`import` work against a local backend.** Inferred from
  `npx convex deployment select local` making the local backend the current deployment plus the documented
  "seed dev deployments" use case; no sentence in the docs names local deployments in the import/export pages.
- **Per-feature local parity list** (file storage, scheduled functions/crons, vector search, auth, components). The
  docs give a limitation list and the agent-mode note about crons and "integrations that aren't available locally",
  but no authoritative supported/unsupported feature matrix for local backends was found.
- **Whether a Convex preview deploy key can create deployments beyond the named project.** The key format is
  `preview:team-slug:project-slug`, which reads as project-scoped, but the docs do not enumerate the exact permission
  set of a preview key (as they do for `deployment:deploy` on production keys).
- **Vercel access-token scoping semantics for a non-team-member.** The CLI flow requires choosing a team, and tokens
  are created from account settings, but the exact token scope options and whether a token can be limited to a single
  project were not confirmed from a primary page in this pass; the REST API reference index was retrieved but the
  access-token section was not read.
- **Exact current wording and default state of Vercel's "Git Fork Protection" toggle.** Its behaviour and location
  ("Security section of your Project Settings") come from
  [Vercel for GitHub](https://vercel.com/docs/git/vercel-for-github); the dedicated settings page describing the
  toggle itself was not retrieved.
- **Whether Convex Business custom roles can restrict a member to a single project.** The teams page mentions
  "custom roles with fine-grained permissions" on Business but does not enumerate them.
  [Convex teams documentation](https://docs.convex.dev/dashboard/teams)
- **Convex preview deployment count limits distinct from the team deployment limit.** Only the shared per-team
  deployment ceiling (40/300/unlimited) was found.
  [Convex limits](https://docs.convex.dev/production/state/limits)
