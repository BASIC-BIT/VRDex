# Public Media Details and History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Keep a neutral source link on media cards and expose accurate public uploader/publication history through the website and MCP.

**Architecture:** Build one allowlisted, on-demand public details projection from existing image, submission and receipt records. The website disclosure and anonymous MCP tool consume that same projection. Resolve actor names only through currently public, owned person profiles.

**Tech Stack:** Existing Node 24, pnpm 10.15.1, TypeScript, Next.js/React, Convex, Zod contracts and MCP SDK 2.0.0.

**Spec:** `docs/superpowers/specs/2026-10-13-public-media-details-history-design.md`

## Global constraints

- Public media cards show View source, not the uploader's name.
- Details & history is public and does not require sign-in.
- Source/reference, uploader, publisher/reviewer and artist credit stay separate.
- Website and MCP use the same sanitized public read model.
- Never substitute the internal asset/submission sourceUrl for public creditUrl.
- Raw user IDs, Clerk subjects, token identifiers and emails remain internal.
- The public response contains at most three events.
- Examine at most 11 ownership records, support up to ten records, and return no public actor on overflow or ambiguity.
- No production data changes, new grants, quota changes or upload-policy changes.
- One follow-up PR, fresh implementer and independent reviewer per task/change round.
- Preserve unrelated `.codex/config.toml` and `.opencode/opencode.json` edits.

## Baseline and file responsibilities

Planning inspected the merged media implementation at `4aca25e`. Current main
was verified as `28865427b02e2ea5015ebf6c8b075dd28c7f7a05`; the newer event-editor
changes do not change this media model. Create/reuse an isolated worktree from
fresh main at execution time. Do not implement on the completed PR #364 branch.
Move these planning documents to the execution branch without unrelated changes.

| File | Responsibility |
| --- | --- |
| `packages/api-contracts/src/public-media-details.ts` (new) | Strict public actor, history, request and response schemas |
| `packages/api-contracts/src/index.ts`, `schemas.ts`, `openapi.ts` | Exports, optional list detailsUrl, public REST operation |
| `convex/_publicMediaDetails.ts` (new) | Public actor/history projection and safe legacy handling |
| `convex/profileAssets.ts`, `_profileAssets.ts` | Public details query, optional detailsUrl in existing projections |
| `convex/schema.ts` | Receipt index for exact publication-operation lookup |
| `apps/web/src/app/_components/public-media-asset-card.tsx` (new) | Existing card presentation plus lazy public disclosure |
| `apps/web/src/app/_components/profile-public-page.tsx` | Replace its local MediaAssetCard with the shared card |
| `apps/web/src/app/api/v0/profiles/[slug]/assets/[assetId]/route.ts` (new) | Anonymous details endpoint, current public API controls |
| `apps/web/src/lib/server/vrdex-mcp.ts` | Public MCP tool and catalog/telemetry allowlists |
| Focused tests, stories and docs below | Privacy, history truthfulness, protocol and visual proof |

## Review focus

1. Private/suppressed/foreign or newly hidden image: detail lookup refuses even with known IDs (Task 1).
2. Missing, private, transferred or ambiguous contributor identity: no account data or arbitrary profile attribution (Task 1).
3. Legacy missing publication timestamp and metadata edits: no invented date, reviewer or duplicate upload (Task 1).
4. Card source/private provenance confusion: only the already-public reference is linked, named credit/uploader stays in details (Task 2).
5. Anonymous MCP transport, contract parsing and disclosure opened after visibility revocation: same safe behavior as website (Task 3).

## Task 1: Shared public details model and bounded backend projection

**Files:** Create `packages/api-contracts/src/public-media-details.ts`,
`convex/_publicMediaDetails.ts`,
`tests/backend/public-media-details.test.ts`,
`packages/api-contracts/tests/public-media-details.test.ts`.
Modify `packages/api-contracts/src/index.ts`, `schemas.ts`,
`convex/schema.ts`, `convex/_profileAssets.ts`, `convex/profileAssets.ts`.
Regenerate `convex/_generated/api.d.ts` normally.

**Interfaces:**

- `PublicMediaActorSchema = { displayName: string; profileSlug: string; profileUrl: string }`; strict, with only public profile values.
- `PublicMediaHistoryEventSchema = { kind: "uploaded" | "approved" | "published"; at: number | null; actor: PublicMediaActor | null }`; strict.
- `PublicProfileMediaDetailsInputSchema = { slug: string; assetId: string }`.
- `PublicProfileMediaDetailsSchema = { profileSlug: string; asset: PublicProfileAsset; referenceUrl: string | null; credit: string | null; uploadedBy: PublicMediaActor | null; history: PublicMediaHistoryEvent[] }`; strict outer/actor/events and a strict copy of PublicProfileAssetSchema for the nested asset, history maximum three. Derive types from these schemas.
- Add optional `detailsUrl` to `PublicProfileAssetSchema` and its Convex public type. Value: `/<slug>#media-<assetId>` only when the public profile renders a gallery or logo disclosure for that asset under its current profile-page field and feature gates. Keep this URL when the asset also has an identity placement. Omit it for avatar-only, banner-only and unplaced assets while retaining their canonical public REST/MCP details reads. No hero disclosures or new pages. No uploader fields on list/card payloads.
- `resolvePublicMediaActor(db: DatabaseReader, userId: Id<"users">): Promise<PublicMediaActor | null>` in `_publicMediaDetails.ts`.
- `projectPublicMediaDetails(db: DatabaseReader, input: { profile: Doc<"profiles">; asset: Doc<"profileAssets">; publicAsset: PublicProfileAsset }): Promise<PublicProfileMediaDetails>`.
- Public query `profileAssets.getPublicAssetDetails({ slug, assetId })` returns that schema or null.

- [ ] **Write failing contract/backend tests.** Assert uploader A and reviewer/publisher B remain distinct; trusted publication has no approval event; independent publication has approval plus publication; owner/imported image has upload only without evidence. Assert source reference equals public creditUrl and excludes a signed/private sourceUrl, notes and private identities. Assert `history.length <= 3`.
- [ ] **Add missing-evidence/identity/visibility cases.** Assert no guessed date from updatedAt; metadata edits preserve event dates; zero/multiple public person profiles or ownership overflow return null actor; private/hidden/transferred identities disclose no name/link. Test hidden kit, hidden primary field, suppression, removed asset, foreign asset, opt-out/draft profile and feature disablement. IDs cannot bypass canonical visibility.
- [ ] **Run to failure:** `node --conditions=import --import tsx --test tests/backend/public-media-details.test.ts`; from `packages/api-contracts`, `node --import tsx --test tests/public-media-details.test.ts`. Expected missing model/query failures.
- [ ] **Implement interfaces.** Query validates slug/ID, checks profile visibility, obtains the existing canonical public media projection and finds the exact asset among its visible asset/placement outputs before projecting detail. Do not add eager actor queries to gallery lists. Validate source-submission linkage, exclude identity-placement proposals and resolve owner-upload subjects through their known issuer/subject mapping, never displayName/email. Cache at most three actor resolutions within a detail read.
- [ ] **Implement exact evidence lookup.** Add `mediaReviewReceipts.by_submissionId_operationId` over `submissionId` and `receipt.operationId`, read at most two matching rows and require the recorded publication actor to match. Use original uploadedAt, independent reviewedAt, or matching committed publication receipt createdAt. Ambiguous/missing evidence never supplies an invented event/date. Do not read general profileAuditEvents.
- [ ] **Verify and commit.** New tests, existing public asset/privacy tests, contract checks, backend typecheck and local Convex bootstrap pass; generated output is stable. Independently review this task before the next task.

## Task 2: Website source link and public details/history disclosure

**Files:** Create `apps/web/src/app/_components/public-media-asset-card.tsx`,
`apps/web/src/app/api/v0/profiles/[slug]/assets/[assetId]/route.ts`,
`apps/web/src/components/public-media-asset-card.stories.tsx`,
`apps/web/e2e/public-media-details.flow.spec.ts`.
Modify `apps/web/src/app/_components/profile-public-page.tsx`,
`packages/api-contracts/src/openapi.ts`, generated OpenAPI outputs,
`tests/web/profile-rendering-boundary.test.ts`,
`apps/web/src/convex/playwright-fixtures.ts`.
Create `tests/web/public-media-details-route.test.ts` for the real REST handler.
Browser fixtures intercept the details request with the shared schema for
isolated disclosure states; joined acceptance uses real local/staging backend
responses. No new production fixture endpoint.

**Interfaces:**

- Consumes Task 1's schemas and `api.profileAssets.getPublicAssetDetails`.
- `GET /api/v0/profiles/{slug}/assets/{assetId}` returns the shared details schema, or the existing public not-found/unavailable problem response. Reuse bearer-query rejection, public API authentication/rate limiting and apiJson.
- `PublicMediaAssetCard({ asset, label, featured = false }: { asset: PublicProfileAsset; label: string; featured?: boolean })` replaces the existing local card with preserved preview/title/download styles.
- The component fetches the REST read once on first disclosure open, shows the sanitized model, and handles a changed visibility refusal without rendering stale/private data.
- Export a presentation view from the same component file for Storybook. Its discriminated state is `closed | loading | ready(details) | unavailable`; the connected wrapper owns transport. Stories exercise the view, not a second implementation of the card.

- [ ] **Write failing rendering/browser tests.** Collapsed card shows View source for safe creditUrl, never Shared by Karly or uploader. Opening Details & history reveals the actual uploader's public link, original credit and supported events. Anonymous visitor can use it. Missing/unsafe reference renders no link; missing actor renders Unavailable without a fabricated link. Opening after a privacy change refuses.
- [ ] **Test navigation and access.** A direct `/<slug>#media-<assetId>` link opens only the matching visible card's disclosure; invalid/foreign anchors do not expose content. Keyboard toggle works, timestamps use the viewer locale, and narrow screens do not clip. No duplicate API call on repeated local toggles.
- [ ] **Run to failure:** `node --import tsx --test tests/web/public-media-details-route.test.ts tests/web/profile-rendering-boundary.test.ts` and `pnpm --filter web exec playwright test e2e/public-media-details.flow.spec.ts` against the repository's local fixture runner. Expected missing disclosure/route failures.
- [ ] **Implement card and route.** Keep uploader/credit text inside the disclosure. View source opens only the existing public creditUrl. Use existing shared preview/loading/error and control patterns. Keep genuine freeform credit in details without inferring an artist or rewriting stored metadata. Preserve existing image/download behavior.
- [ ] **Verify and commit.** Typecheck/lint/contract OpenAPI freshness pass. Capture desktop/mobile collapsed and expanded stories, verify with VLM review, and review screenshots for exact approved labels. Independent task review must cover public/privacy parity.

## Task 3: Public MCP read, docs and joined staging acceptance

**Files:** Modify `apps/web/src/lib/server/vrdex-mcp.ts`,
`tests/web/vrdex-mcp.test.ts`,
`tests/backend/hosted-mcp-profile-media.test.ts`,
`docs/developers/vrdex-mcp-read-tools.md`,
`docs/engineering/media-review-commands.md`.
Create `docs/testing/public-media-details-history.md`.
Modify `packages/vrdex-mcp/src/api-client.ts`, `server.ts` and their focused
package tests so standalone stdio clients expose the same public read through
the REST endpoint. Reuse the approved tool name, description and output schema.
Update existing tool-catalog/OpenAPI documentation fixtures and the installed-client
preflight's expected catalog when required by its current schema.

**Interfaces:**

- Public read tool `vrdex_get_profile_media({ slug: string; assetId: string })`.
- Output: Task 1's `PublicProfileMediaDetailsSchema`. Invalid/unavailable image uses the same existing public-read unavailable/not-found handling as `vrdex_get_profile`.
- Advertise the existing public read security schemes and `readOnlyHint: true`, `idempotentHint: true`. No new OAuth scopes or write operations.
- Proposed exact description: "Read an image's public details, uploader attribution and publication history."
- Add the tool to actual registration, known public tool names and telemetry/catalog allowlists. Existing authenticated contribution/reviewer schemas retain their private permissions.

- [ ] **Write failing protocol tests.** Actual tools/list advertises the new read tool without retired declarations or new write capabilities. Actual tools/call validates the shared output, distinguishes A uploader/B publisher, and anonymously reads the same model as REST. Private/source-note/account fields cannot appear. Revoked public visibility produces an unavailable result; known IDs and signed-in status cannot bypass it.
- [ ] **Run to failure:** `node --import tsx --test tests/web/vrdex-mcp.test.ts` and `node --conditions=import --import tsx --test tests/backend/hosted-mcp-profile-media.test.ts`, expecting the new tool to be absent.
- [ ] **Implement the read adapter and docs.** Call the public query with the public Convex client, validate mcpJsonResult with the shared schema, and preserve protocol/rate-limit behavior. Document actor/date fallback, public-only history scope and client catalog refresh separately from server deployment.
- [ ] **Verify standalone parity.** Register the same tool in the stdio package, route it through the new public REST read, and test actual tools/list and tools/call with the shared strict schema and unavailable response handling.
- [ ] **Run joined acceptance.** Use synthetic local/staging assets for owner upload, trusted publication and distinct independent approval. Inspect actual website disclosures, public API and anonymous hosted MCP results for the same asset IDs and histories. Change privacy and verify fresh refusal. Keep any fixture setup/cleanup within the existing approved staging harness; do not publish real user media as a test. A missing/new tool in the loaded client catalog is a failed client acceptance condition, not proof of a server failure or permission to reinstall/rotate credentials.
- [ ] **Verify and commit.** Focused tests, web/backend types, generated Convex/OpenAPI/catalog checks and exact-candidate hosted public-read proof pass. Independent task review, then one whole-branch review. No repeated broad suite/review unless new findings justify it.

## Self-review and implementation handoff

The spec's card, disclosure, actor, history, privacy and MCP decisions map to
Tasks 2, 2, 1, 1, 1 and 3 respectively. Each Review Focus input has an explicit
owning test above. Website and MCP consume the same schema/query; actor/history
field names match across tasks. The model adds one bounded receipt index,
not a second public event database or a migration.

Execution approved 2026-10-15, including the exact MCP description above. Tasks 1
and 2 passed independent review. Task 3 implements hosted/stdio parity, docs and
the guarded joined staging acceptance extension. Independent Task 3 review, whole-branch
review and controller-owned exact-candidate staging proof remain required.

After execution approval, use the preserved subagent implementation/review
workflow and one PR. Any later merge-ready review loop must satisfy the pushed
head's full 30-minute window, then refresh every feedback/check surface and
resolve handled threads before the final readiness claim. Do not merge or
deploy merely because this planning document was approved.
