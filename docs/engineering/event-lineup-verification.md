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

## Public host roster

Published community events expose a read-only `/[community]/events/[event]/host`
roster. The event page links to it. Authored slot keys preserve repeated sets,
freeform entries, and entries without stream links. The selected slot source is
separate from the other public stream choices and the scheduled-current label.
No broadcast-selected indicator is inferred from schedule or provider liveness.

The event-scoped `/host/status` GET resolves the published public projection on
its server; it accepts no client probe URLs. It returns only normalized source
keys, `state`, and `observedAt`. Shared provider caches retain fetch timestamps;
the host aggregator deduplicates for 30 seconds, limits active checks to four,
and expires indicators after 60 seconds. Provider errors do not block rendering
or copying links. Status is not decoded-media readiness or handoff evidence.
The host roster subscribes to the public event query so revoked links disappear.
The selected source and copy controls lead each compact slot. Other links and
URLs expand on demand. Preview mounts one muted VRCDN player only after an
explicit click; closing it, switching previews, or collapsing its alternative
links releases the previous player. Twitch Open retains its external watch link.

Local checks: `node --import tsx --test tests/web/event-host-view.test.ts` and
`pnpm --filter web exec playwright test event-host-view.flow.spec.ts --project=desktop-chromium --project=mobile-chromium`.
The deterministic browser check holds/fails status while exercising PC and Quest
copy actions and checks for unsolicited media elements. Live VRCDN connection
impact and real Twitch API acceptance require separately authorized provider
validation; the deterministic tests do not establish provider readiness.

## Retained event playback

The root `EventPlaybackProvider` sits outside Convex's authenticated provisioning
gate. Its media mount owns native/MPEG-TS video, `EventLineupSession`, or the
supported visible Twitch SDK player. Event routes provide Play intent and metadata;
they never receive or move the media node. Repeated Play for the active source
retains it; explicit Play for another event disposes the previous adapter first.

The provider revalidates the active event's public `events.getPublicBySlug`
projection anonymously, immediately and every 15 seconds after a successful
response, independently of the viewed route. Errors or a 10-second response
timeout dispose playback. Browser timer suspension can delay these checks.
Missing/private, disabled, cancelled, or removed sources revoke playback. Calendar
end only blocks new starts. Same-ID playback URL changes release the previous
transport and require Play; identical sequence projections leave source evidence
and prepared inputs intact. No Convex URL means no revalidation client is created,
which supports configuration-free fixtures but provides no remote revocation feed.

`EventCompactPlayer` keeps the same root shell, media mount and DOM ancestry.
It measures the active inline placeholder and positions that shell over it; when
no fully visible matching slot exists it uses a compact presentation. The inline
slot stops showing its Play poster once active. Return links use client navigation.
Pause, volume/mute, fullscreen, close and performer selection control the same
owner. Compact clearance is retained while the session exists so moving inline
near the bottom of a page does not clamp scroll or oscillate. Close releases both
transport and clearance. Clearing playback through Close or revocation exits
fullscreen only when the retained shell owns it, including a pending fullscreen
entry that completes after playback was cleared. VisualViewport bounds/offsets and safe-area insets protect
compact positioning when the visual viewport differs from the layout viewport.
The shared Play poster explicitly fills its parent width, avoiding aspect-ratio
min-height expansion on narrow event/profile/watch surfaces.

Twitch uses the official SDK with application controls below the iframe. A 400px
shell has no border subtracting from the required 400x300 media area. Viewports
below 400px width or 472px available height (including the retry/status row) dispose/suspend the embed and show
`External playback` with `Open stream`. Expanding the viewport requires explicit
Play to recreate it. Sizing limits do not assert a provider failure. The root
mount remains in place even when its disposed iframe is removed.

`event-persistent-playback.flow.spec.ts` fulfills a canonical VRCDN URL with the
checked-in, rights-cleared synthetic MPEG-TS fixture through the real production
loader, mpegts.js/MSE and decoder. Managed/direct fixture source identities and
performer-sequence playback prove actual video identity, unchanged parent and
advancing currentTime through route/history/layout changes. Tests also cover
repeated slot identity, explicit replacement, route-away revocation via the real
polling helper with a synthetic public projection reader, close, keyboard focus,
fullscreen, scroll, both themes, and small mobile widths. Fixture provenance and
optional FFmpeg regeneration are in `apps/web/e2e/fixtures/README.md`; running the
tests needs no FFmpeg installation.

The fixture's profile/event routes and auth-layout gate are synthetic: this is
not configured Convex/Clerk or managed worker output acceptance. Chromium's
finite media fixture does not prove Safari, mobile background playback or live
provider reconnect behavior. `event-playback-owner.spec.ts` additionally keeps
native WAV and legacy/profile foreground handoff coverage. SDK stubs test Twitch
controls and viewport disposal deterministically, separately from live providers.
A public supported-embed probe on October 19, 2026 loaded the real Twitch SDK and
iframe (HTTP 200), showing Monstercat's provider-rendered offline state. It did not
establish live Twitch media playback. No provider publishing or account creation
was involved.

Run both browser suites on desktop/mobile Chromium:

```sh
pnpm --filter web exec playwright test event-persistent-playback.flow.spec.ts event-playback-owner.spec.ts --project=desktop-chromium --project=mobile-chromium
```

Explicit Play also crosses a shared synchronous foreground boundary. Legacy
YouTube/Twitch-clip iframes mount only after application Play acquires that
boundary, and are discarded when another player acquires it. Profile VRCDN
players participate on audible Play/unmute; muted previews remain independent.
Browsing alone does not acquire playback. Unavailable retained sources receive a
fresh adapter on retry, with volume/mute preserved; autoplay-blocked sources retry
the existing adapter. Native video pause, ended, error and playing events update
owner state, and adapter disposal removes their listeners. Local media EOF is a
paused connection, not authoritative event completion.
