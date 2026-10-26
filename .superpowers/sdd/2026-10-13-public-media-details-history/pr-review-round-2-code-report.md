# PR372 round 2 code and docs report

## Result

The details-destination finding is valid. `getPublicProfileMediaKit` now applies the existing `canReadProfile("public", profile)` policy before advertising details links. Owner preview images and downloads retain authenticated access. Public gallery links and selected-logo links with the gallery disabled remain available.

The real `previewProfileFromBrowser` test covers draft/private, opted-out, suppressed and archived profiles. Each retains owner image access, omits details links, and returns null from the anonymous details query. Public positives exercise the gallery and disabled-gallery logo cases. An unsaved display-name edit preserves saved field visibility. The preview validator does not accept publication/surfacing or field-visibility changes, so unsaved visibility changes cannot reach this boundary. No new preview option or owner details endpoint was needed.

The stale catalog guidance is valid, but seven/twelve is incomplete for the current server. Anonymous stdio lists seven reads, including `vrdex_get_profile_media`. A bearer credential adds five base operations, ten shared event-intake tools and one local upload helper, for 23 total. Current guidance in all three requested documents now uses the actual counts. Historical evidence remains unchanged.

## Verification

- RED: `node --conditions=import --import tsx --test tests/backend/profile-preview-response.test.ts` failed because a draft owner preview advertised `/preview-assets#media-...` instead of omitting detailsUrl.
- GREEN: `node --conditions=import --import tsx --test tests/backend/profile-preview-response.test.ts tests/backend/public-media-details.test.ts` passed all 18 tests after the final test additions.
- Backend: `node node_modules/typescript/bin/tsc --noEmit --project convex/tsconfig.json` exited 0.
- `pnpm exec tsc --noEmit --project convex/tsconfig.json` could not start because Corepack could not resolve registry.npmjs.org. The installed compiler above completed the same check.
- Catalog: from `packages/vrdex-mcp`, `node --import tsx --test tests/stdio.test.ts` passed both exact tools/list assertions, proving seven anonymous and 23 credentialed tools. The anonymous test passed. The credentialed test then failed at its unchanged line 233 search structuredContent expectation, receiving undefined. A bounded rerun with `VRDEX_MCP_OUTPUT_MODE=detail` had the same failure. Root identified prior sandbox loopback restrictions for this test. One authorized `require_escalated` rerun of the same command passed both tests, including all API calls and media details. This confirms an environment restriction rather than a product failure. No test or unrelated output behavior was changed.
- Markdown: `node node_modules/markdownlint-cli2/markdownlint-cli2-bin.mjs docs/developers/mcp-client-compatibility.md docs/developers/vrdex-mcp-event-writes.md docs/planning/public-api-and-mcp-platform.md` validated 217 files with zero errors.
- `git diff --check` passed.

Applied unslop to the current guidance and this report. No public UI copy changed. No remote operations, services, pushes, PNG modifications or scratch cleanup occurred.

## Checkpoint

Base: `bcb4ff7ab53eaa14a8ef352b18b6c19d694aa055`. The scoped fix commit is the commit containing this report; its hash is reported in the implementer handoff.
