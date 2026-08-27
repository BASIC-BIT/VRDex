# Claude pull request review

## Status

Current implementation. The reviewer is a bounded, read-only second opinion;
it does not replace CI, human judgment, or the repository's merge-ready gate.

## Design basis

The implementation blends locally audited patterns instead of copying one
repository wholesale:

- `basic-infra` remains the source of truth for the secret container, narrow
  read policy, and repository-specific GitHub OIDC trust.
- Chronote supplied the proven AWS retrieval path, prior-review context,
  explicit hook disabling, user-only setting sources, and fail-closed publish
  behavior.
- Drasil and Vintage Story Mods supplied the trusted-base
  `pull_request_target` shape, isolated head checkout, and base-owned review
  contract.
- Selecta and `vrchat-mcp` supplied the deliberate 60-turn starting limit,
  terminal sticky states, stale-result refusal, and protection against a failed
  replay replacing a completed review.
- Perkcord demonstrated the value of per-pull-request cancellation and a skip
  label, while its workflow/documentation drift is why limits and safety flags
  are stated directly here.
- `faceless-core` had no reviewer to reuse; historical reviewer quota failures
  reinforced explicit triggers and visible unavailable states.

The first version deliberately omits automatic code changes, thread resolution,
and rerunning every review whenever `main` advances. Those add cost and workflow
surface without replacing the repository's existing exact-head recycle gate.

## When it runs

The trusted default-branch workflow reviews same-repository, non-draft,
human-authored pull requests targeting `main` when they are opened, reopened,
marked ready, or synchronized. Removing `skip-claude-review` also triggers a
fresh review. Forks and bot-authored pull requests do not receive the shared
credential.

One review may run per pull request. A newer eligible event cancels the older
run. The `skip-claude-review` label cancels work and records that the review is
unavailable. Draft conversion, closure, and base retargeting also invalidate
the sticky result.

## Trust and permissions

`.github/workflows/claude-review.yml` uses `pull_request_target`, so its workflow
definition comes from the trusted default branch. The review job checks out the
trusted base and the exact pull request head into separate directories. It does
not run project scripts, dependency installers, builds, tests, or hooks from the
pull request.

Claude receives only the Read tool. Repository hooks are disabled, setting
sources are restricted to the workflow's user settings, and head-owned agent
instructions are denied as instruction sources. `REVIEW.md` is loaded from the
base commit; a pull request can propose changes to it but cannot weaken its own
review contract.

The model job has repository read permissions plus `id-token: write`. It cannot
comment. A separate five-minute publisher has comment permission, no checkout,
and re-reads the live pull request before publishing. It refuses stale head or
base results and does not replace a completed exact-head review with a failed
replay.

## Credential and infrastructure

The canonical subscription OAuth credential remains in AWS Secrets Manager at
`/basic/shared/claude-code-oauth-token` in `us-east-2`. The workflow assumes
`basic-shared-claude-github-review` through GitHub OIDC for 15 minutes. AWS
credentials exist only in the retrieval step, and the fetched token is masked.
No long-lived Anthropic or AWS credential belongs in VRDex repository secrets,
source, logs, artifacts, Terraform state, or pull request comments.

The shared role, secret container, allowed repository subjects, permissions,
and recovery procedure are owned in `BASIC-BIT/basic-infra` under
`terraform/stacks/shared-secrets` and `docs/shared-claude-oauth.md`. Adding or
removing VRDex is an infrastructure pull request there, not a dashboard-only
repository setting.

## Cost controls

- draft, fork, bot, skipped, and superseded runs do not spend review quota
- per-pull-request concurrency cancels superseded work
- the job is limited to 25 minutes and 60 Claude turns
- the prompt starts from the diff and opens source only for needed local context
- web, shell, write, and delegation tools are unavailable
- output and previous-review context are byte-bounded

The workflow uses the shared Claude Code subscription credential rather than an
Anthropic API key. There is no claim of a dollar ceiling. If observed usage is
too high, prefer a narrower trigger policy or deliberate opt-in over weakening
review depth silently.

## Result format and follow-up

The publisher owns one comment marked `<!-- claude-pr-review -->`. A completed
comment records the exact reviewed head and base in hidden markers, begins with
`[AGENT]`, lists source-linked findings by priority, and ends with an explicit
Important-finding status. Failures and invalidations say that they are not an
approval. Publication failure fails the workflow.

Each synchronize event supplies the previous completed sticky review as bounded
context so Claude can avoid repeating resolved findings. The workflow never
edits code, opens inline threads, resolves comments, or pushes a branch.
Recycler work stays with the implementing human or agent:

1. Read the current sticky result together with all other review surfaces.
2. Classify each finding as apply, reject with reason, split to follow-up, or
   ask one focused question.
3. Make the smallest correct patch and run relevant verification.
4. Reply to and resolve handled review threads before pushing.
5. After every push, wait for the required exact-head window and re-read checks,
   ordinary comments, review threads, formal reviews, and mutable sticky
   summaries before calling the pull request merge-ready.

## Bootstrap and verification

Because `pull_request_target` loads its workflow from the default branch, the
pull request that first adds this workflow cannot run the new reviewer against
itself. Before merge, parse the YAML, run `actionlint`, lint and build the docs,
and confirm the basic-infra trust change is reviewable.

After both changes reach their default branches, prove one eligible pull request
end to end: role assumption, secret retrieval, Claude inference, exact-head/base
markers, sticky update, synchronize rerun, skip cancellation, and stale-result
refusal. Treat any missing proof as `UNKNOWN`, not as a passing review.
