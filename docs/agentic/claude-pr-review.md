# Claude pull request review

## Status

Current implementation. The reviewer is a bounded, read-only second opinion;
it does not replace CI, human judgment, or the repository's merge-ready gate.

VRDex uses BASIC's shared reusable reviewer,
[`BASIC-BIT/claude-review`](https://github.com/BASIC-BIT/claude-review), called by
`.github/workflows/claude-review.yml`. The reviewer logic, limits, and publishing
live in that repository; this repository keeps only the caller and its review
contract in `REVIEW.md`. It replaced a repository-owned reviewer and its control
and reconciliation workflows on 2026-11-03.

## When it runs

The caller runs on `pull_request_target`, so its workflow definition comes from
the trusted default branch. The shared workflow reviews same-repository,
non-draft, human-authored pull requests that target the default branch when they
are opened, reopened, marked ready, or synchronized. Removing
`skip-claude-review` triggers a fresh review. Forks and bot-authored pull
requests are rejected before any credential is requested.

The `skip-claude-review` label opts a pull request out. Create or recover it with
the checked-in command below; `--force` keeps the description and color
reproducible:

```powershell
gh label create skip-claude-review --repo BASIC-BIT/VRDex --color 6E7781 --description "Skip the bounded Claude PR review" --force
```

## Trust and permissions

The shared workflow checks out the trusted base, uses the pull request head only
to compute the diff, and deletes it before the token is fetched. It never runs
project scripts, dependency installers, builds, tests, or hooks from the pull
request. Claude receives only the Read tool. `REVIEW.md` and root `AGENTS.md`
are read from the base commit, so a pull request can propose changes to them
but cannot weaken its own review.

Only the shared workflow's review job holds `id-token: write`, and only its
publish job can comment. A caller cannot add steps or inputs to either.

## Credential and infrastructure

The canonical subscription OAuth credential stays in AWS Secrets Manager at
`/basic/shared/claude-code-oauth-token` in `us-east-2`. The shared workflow
assumes `basic-shared-claude-github-review` through GitHub OIDC. The role trusts
only the shared workflow at an approved commit, run from the default branch, for
repositories BASIC owns. No long-lived Anthropic or AWS credential belongs in
VRDex repository secrets, source, logs, artifacts, or comments.

The role, its trust, and the release procedure are owned in `BASIC-BIT/basic-infra`
(`terraform/stacks/shared-secrets`, `docs/shared-claude-oauth.md`). Moving the
caller to a new shared reviewer release means pinning a commit SHA that the
role already trusts.

## Cost controls

- draft, fork, bot, and skipped pull requests do not spend review quota
- review input stops at 250 changed paths or a 500,000-byte diff
- the model step is limited to 20 minutes and 100 turns, with only the Read tool
- the previous review is passed as bounded, untrusted context

The reviewer uses the shared Claude Code subscription rather than an Anthropic
API key. There is no dollar ceiling. If usage is too high, prefer a narrower
trigger policy over silently weakening review depth.

## Result format and follow-up

The shared reviewer owns one sticky comment marked `claude-pr-review`. A
completed comment names the reviewed head and base, lists source-linked findings
by priority, and ends with an explicit Important-finding line. Failures say they
are not an approval. It never edits code, opens inline threads, resolves
comments, or pushes a branch.

Recycler work stays with the implementing human or agent:

1. Read the current sticky result together with all other review surfaces.
2. Classify each finding as apply, reject with reason, split to follow-up, or
   ask one focused question.
3. Make the smallest correct patch and run relevant verification.
4. Reply to and resolve handled review threads before pushing.
5. After every push, wait for the required exact-head window and re-read checks,
   ordinary comments, review threads, formal reviews, and mutable sticky
   summaries before calling the pull request merge-ready.

The shared reviewer does not re-mark old reviews as stale when `main` advances.
Each review names the commits it covered, so compare those against the current
head and base.
