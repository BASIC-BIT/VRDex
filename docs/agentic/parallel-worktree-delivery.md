# Parallel Worktree Delivery

## Status

Candidate workflow for VRDex implementation programs that are too large to run
comfortably in one serial agent session. This is local to VRDex until proven
useful and explicitly promoted.

## Purpose

Use parallel worktrees to let several focused agents implement leaf work at the
same time while a coordinator keeps contracts, merges, verification, and docs
coherent.

This is not a replacement for design. Use it only after the feature has a clear
issue tree, shared contracts, and objective checks.

## When To Use

Use this workflow when all of these are true:

- the work has several mostly independent slices
- each slice can be verified with local commands or artifacts
- branch isolation materially reduces context or file-conflict risk
- the coordinator can define shared contracts before fanout
- the team wants a local integration branch before opening one public PR

Do not use it for narrow fixes, destructive provider changes, risky migrations
without a root contract, or work that needs a single continuous debugging
context.

## Terms

- `root`: the sequential foundation work that defines shared contracts, data
  shapes, test fixtures, and merge order.
- `leaf`: an independently testable implementation slice in its own worktree and
  branch.
- `coordinator`: the main session that owns the integration branch, merge queue,
  final docs, and final verification.
- `kickoff packet`: a concise instruction artifact for a leaf agent with scope,
  constraints, paths, dependencies, and required checks.
- `integration branch`: the local branch that receives leaf merges before a
  public PR is opened.
- `reviewer`: a fresh-context pass that checks a completed leaf or integrated
  diff before it is accepted.

## Standard Layout

Use the existing bench worktree pattern:

- protected mirror: `D:\bench\VRDex`
- worktree root: `D:\bench\VRDex-wt\`
- coordinator worktree: `D:\bench\VRDex-wt\<program>-integration`
- leaf worktrees: `D:\bench\VRDex-wt\<program>-<slice>`

For the restreaming program, candidate paths are:

- `D:\bench\VRDex-wt\restream-integration`
- `D:\bench\VRDex-wt\restream-control-plane`
- `D:\bench\VRDex-wt\restream-vrcdn-secrets`
- `D:\bench\VRDex-wt\restream-ffmpeg-proof`
- `D:\bench\VRDex-wt\restream-ecs-benchmark`
- `D:\bench\VRDex-wt\restream-discord-gateway`

Keep `AGENTS.local.md` in each worktree to record the local role. Do not commit
it.

## Workflow

1. Build the root contract first.

   The coordinator defines or confirms:

   - issue tree and leaf boundaries
   - shared domain types and command vocabulary
   - secret, permission, and audit boundaries
   - test fixture strategy
   - verification commands
   - merge order and known dependency edges

   Do not fan out until each leaf can start from a stable enough contract.

2. Create kickoff packets.

   Each leaf kickoff should include:

   - target branch and worktree path
   - owned issue slice
   - files and docs to read first
   - files or surfaces to avoid
   - accepted dependencies on other leaves
   - required local checks
   - expected final report shape
   - whether code edits are allowed
   - whether provider or destructive actions are forbidden

   Use tracked docs for durable kickoff patterns and ignored `.opencode/state/`
   files for transient assignments.

3. Create local worktrees.

   Create each leaf from the integration branch, not from a stale protected
   mirror branch.

   Suggested branch naming:

   - `program/restream/integration`
   - `program/restream/control-plane`
   - `program/restream/vrcdn-secrets`
   - `program/restream/ffmpeg-proof`
   - `program/restream/ecs-benchmark`
   - `program/restream/discord-gateway`

4. Run leaf agents.

   Leaf agents should:

   - work only in their assigned worktree
   - keep commits local unless the coordinator asks otherwise
   - avoid broad refactors outside their slice
   - update docs that directly match their behavior
   - run required checks before reporting done
   - write a concise handoff with changed files, checks, blockers, and merge
     risks

   Leaf agents should not open PRs, push branches, trigger paid reviews, deploy,
   or mutate provider settings unless the human explicitly approves that step.

5. Converge locally.

   The coordinator merges or cherry-picks leaves into the integration branch in
   dependency order.

   For each leaf:

   - inspect status and diff
   - verify the leaf's checks
   - merge or cherry-pick locally
   - resolve conflicts in the integration worktree
   - run the relevant integrated checks
   - record accepted, deferred, or rejected leaf output

6. Review and recycle.

   Use fresh-context reviewers for high-risk or wide diffs. Recycle only
   verified feedback.

   The reviewer should focus on:

   - correctness and integration bugs
   - secret exposure
   - permission and audit gaps
   - test or verification gaps
   - docs drift
   - behavior that violates product decisions

7. Open the public PR only after local integration is coherent.

   The public PR should contain the integrated branch, not a pile of
   uncoordinated leaf branches. Keep PR prose concise and do not duplicate
   routine CI checklists.

## Coordination State

Start with ignored local state:

- `.opencode/state/worktree-swarm.json`
- `.opencode/state/inbox.md`
- `.opencode/state/<program>-merge-log.md`

The state can track:

- program name
- integration branch and path
- leaf branch, path, owner/session, status, dependencies, checks, and last update
- merge order
- blockers

Do not store secrets, stream keys, provider tokens, signed URLs, or private user
data in shared state.

## Async Options

Start simple:

- parallel `task` subagents for research, review, and code exploration
- manual OpenCode sessions in separate worktrees for implementation leaves
- ignored inbox files for status handoff

If the sibling toolbox exists, `basics-agentic-dogfooding` provides useful
reference patterns:

- `docs/agentic/agentic-vision.md`
- `.opencode/skills/swarm-coordination/SKILL.md`
- `docs/opencode/supervisor-loop.md`
- `docs/opencode/pr-review-watch.md`
- `docs/opencode/toolbox.md`

Use supervisor or async watcher tooling only after the simple file-backed
workflow proves too manual.

## Restreaming Program Shape

The approved restreaming slices are:

1. Control-plane schema, commands, and audit model.
2. Operator-owned VRCDN setup, secrets, and rights/compliance gates.
3. Local FFmpeg proof with watchable `1080p60` evidence.
4. ECS/Fargate benchmark with GPU fallback decision.
5. Shared web control room plus early Discord Gateway foundation.

Recommended root-first sequence:

1. Establish the integration branch and root contracts.
2. Implement enough control-plane vocabulary for leaves to share command,
   session, source, output, secret, and audit concepts.
3. Then fan out the VRCDN setup, FFmpeg proof, ECS benchmark draft, and Discord
   Gateway foundation where dependencies allow.

Cloud IaC can be drafted in parallel with the local worker proof, but any hosted
promise remains behind the `1080p60` benchmark gate.

## Promotion Path

Current recommendation:

- Keep this as a VRDex-local workflow for the first restreaming implementation
  experiment.
- Capture what worked, what conflicted, and what needed human coordination.
- If the workflow materially improves throughput without lowering quality,
  propose a global/shared skill promotion with a human question gate.

Promotion record template:

- current level: VRDex doc and optional repo-local skill
- target level: shared OpenCode skill or basics-agentic-dogfooding toolbox doc
- reason: repeated successful parallel delivery pattern
- over-promotion cost: more process weight for small tasks
- demotion path: keep only as repo-local doc
- verification signal: multiple leaf worktrees merged locally with fewer
  conflicts and passing integrated checks

## Failure Modes

- leaf branches drift because root contracts were not stable enough
- agents duplicate work because kickoff packets are vague
- integration branch becomes a dumping ground without merge discipline
- transient `.opencode/state/` files become the only source of truth
- local merges hide review gaps that a normal PR sequence would have caught
- broad global promotion happens before the workflow proves itself

When these appear, stop fanout, consolidate centrally, and reduce the active
leaf count.
