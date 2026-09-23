# Event lineup verification

Local verification as of September 16, 2026, on the cohesive event-lineup branch.
No deployment or live event write is established by these results.

## Connected data story

`tests/backend/event-lineup-story.test.ts` creates a draft through the same
`createCommunityEvent` mutation used by the browser, verifies it is not public,
rejects unauthenticated publication, publishes as its owner, reads the editable
selection, discovers the event through `listPublicUpcoming`, and obtains its
actual `getPublicBySlug` projection. That exact projection crosses the Convex
HTTP transport fixture into the real public GET route and the hosted MCP handler.
A real stdio MCP child process then reads the actual GET route through a loopback
HTTP server. Both MCP results must preserve the authored slots and participants.
No independently constructed roster stands in for the authored event.

The browser story in `apps/web/e2e/event-lineup-story.spec.ts` additionally keeps
one Convex test instance alive through a bounded Node child bridge. Its actual
editable query bootstraps the real `EventEditorForm`. Playwright changes the title
and selected stream, captures the submitted arguments without rewriting them,
and sends those arguments to the real owner-authorized `updateCommunityEvent`.
The bridge rejects the same update without an identity, confirms draft privacy,
publishes, discovers and projects that same event, then runs the HTTP/hosted/stdio
serializer helper. The returned projection bootstraps `EventPublicPage`; the test
asserts the changed title, performer link and stream URL. Play requests only the
newly selected stream, intercepted with HTTP 503 before reaching any provider.
This chain passes in desktop and mobile Chromium.

The fixture replaces browser query/mutation transport, not editor serialization,
backend authority or projection code. It does not establish authenticated deployed
browser connectivity. Existing reactive-player tests retain their controlled query
boundary and separate real loopback media evidence.
Privacy, removed selections and cancellation remain covered by the actual backend
projection suite; existing owner, staff and API scope tests remain unchanged.

## Verification ledger

| Check | Result | Evidence |
| --- | --- | --- |
| Full backend | 798 passed, exit 0 before frontend-only integration | `.tmp/verify-backend.log` |
| Full API contracts / MCP | 38 / 7 passed, exit 0; inputs unchanged | `.tmp/verify-api-contracts.log`, `.tmp/verify-vrdex-mcp.log` |
| Contract/MCP types and OpenAPI | exit 0; inputs unchanged | `.tmp/verify-typecheck-api-contracts.log`, `.tmp/verify-typecheck-vrdex-mcp.log`, `.tmp/verify-check-api-openapi.log` |
| Final web suite | 486 passed, zero skipped; prior session exit handle unavailable | `.tmp/task6-web.log` |
| Final web types / lint | exit 0 for both; repeated to recover definitive status | `.tmp/task6-types-web-final.log`, `.tmp/task6-lint-web-final.log` |
| Backend projection plus connected story | 11 passed, exit 0 | `.tmp/task6-backend-focused.log` |
| Review-fix web types / targeted lint | exit 0 for both | `.tmp/task6-fix-types.log`, `.tmp/task6-fix-lint.log` |
| Backend types after local codegen | exit 0 | `.tmp/task6-types-backend.log` |
| Connected browser story, editor/roster flows and snapshots | 16 passed, exit 0 after review fix | `.tmp/task6-fix-covering.log` |
| Local Convex generation | Convex 1.32.0, health status ok; prior exit handle unavailable | `.tmp/task6-codegen.log` |

Reused broad checks apply only to unchanged inputs. The new story has its own
focused run; the full web suite was not repeated after adding backend coverage.
Local codegen adds the missing `_eventPlayback` generated API import and map.
The generated README scaffold rewrite was discarded.

## Visual inspection

The four passing baseline comparisons were inspected as actual image files under
`apps/web/e2e/__screenshots__/`. Desktop uses a 1280 by 900 viewport. Mobile uses
Playwright's Pixel 7 preset, 412 by 839 CSS pixels. Full-page image sizes:

| Image | Dimensions |
| --- | --- |
| `desktop-chromium/event-lineup-roster.png` | 1280 by 2836 |
| `desktop-chromium/event-lineup-editor.png` | 1280 by 2890 |
| `mobile-chromium/event-lineup-roster.png` | 412 by 3290 |
| `mobile-chromium/event-lineup-editor.png` | 412 by 3780 |

Repeated performers, multiple streams, a freeform row and public participant
links remain legible. Long links wrap inside mobile cards and copy controls stay
inside their rows. Editor mode and removed-source choice remain visible. Sequence
mode omits irrelevant output operations. No new visual correction was needed.
Playback screenshots and measured transport evidence are documented in
[event-lineup-player.md](event-lineup-player.md) and
[event-playback-proof.md](event-playback-proof.md).

## Remaining operational evidence

The current client tool inventory exposes event search but no dedicated event
read/write tools. This does not establish server absence or OAuth scope. Client
visibility and sufficient authorization must be verified before an operator uses
those tools. Local MCP configuration was not changed.

Native hidden-window behavior, OS suspension, Safari/iOS audio, hardware volume,
live-provider CORS/encoder compatibility and a human listening comparison remain
unverified. Injected autoplay rejection proves the recovery control only. The
historical Firefox error and subsequent cancellation evidence retain the limits
recorded in the player document.

Whole-branch independent review, the single PR, terminal CI and the 30-minute
exact-head review window belong to the controller. Production auth smoke still
needs `VRDEX_PRODUCTION_AUTH_SMOKE_STORAGE_STATE_B64` from a safe dedicated
production test account before that lane can be enabled. Merge, deployment and
production event mutation require their separate authorization.
