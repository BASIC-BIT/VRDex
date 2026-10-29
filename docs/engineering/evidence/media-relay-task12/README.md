# Complete-flow local acceptance evidence

Status: Chromium composed acceptance passed, including native-first startup,
source recovery, worker takeover and explicit MSE recovery. Firefox cannot launch
in this container; its coverage remains open. Hosted and physical-device release
gates remain open. These fixtures never enable a deployment.

The composed harness runs real Convex admission, grant, worker and gateway
handlers in isolated `convex-test` state. Production registry, watchdog,
copy-only packager, publisher, manifest handler and demand coalescer serve
FFmpeg-generated H.264/AAC media over loopback HTTP. In-memory storage replaces
S3; it is not provider capacity or cost evidence. Browser routing bridges the
fixture origin to loopback. Native browser playback and MSE are identified
separately in the final results.

`desktop.png` and `phone-width.png` capture the actual composed player.
A narrow Chromium viewport establishes layout only, not physical phone behavior.

## Reproduction

Activate `/workspace/vrdex-env.sh` in the managed environment. Prepare the local
backend with `/workspace/.vrdex-tools/prepare-local.sh`, then let Playwright own
its servers. Clear ambient Clerk values for this anonymous fixture lane:

```sh
CLERK_SECRET_KEY='' NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY='' \
  CONVEX_ADMIN_TOKEN='' MOBILE_MEDIA_ACCEPTANCE=true \
  NATIVE_HLS_PLAYBACK_PROOF=true EVENT_PLAYBACK_PROOF=true \
  pnpm --filter web exec playwright test \
  mobile-hls-playback.spec.ts event-lineup-live.spec.ts
```

The longer demand case requires `MOBILE_MEDIA_LONG_PROOF=true`. It disables page
JavaScript after decoded media progress, polls uncached manifests from a separate
Node HTTP client for 185 seconds, reuses previously downloaded segment bytes,
then stops requests and waits through the actual 180-second idle grace. This
models native request demand independently of JavaScript; it does not establish
Safari suspension or operating-system playback.

Production artwork packaging check:

```sh
NEXT_PRIVATE_STANDALONE=true pnpm build:web
node scripts/verify-mobile-media-artifact.mjs
```

The artifact script checks the actual route `.nft.json`, copies only the generated
standalone tree plus Next's required static/public directories to isolated scratch,
serves the real production route, fetches the PNG derivative and neutral asset,
and checks privacy reauthorization after caching. Convex/storage responses are
local transport fixtures, including Redis REST rate-limit responses. It does not
prove hosted storage authorization.

See [release proposal and rollback](../../media-relay-verification.md) for the
independent hosting, budget, containment and physical-device requirements.

## Recorded results

- `demand-final.json`: final readiness policy, 2026-10-29T02:36:05.923Z start,
  186949ms request interval, 93 manifest polls, 641 cached segment hits,
  19 coalesced demand writes, idle cleanup to zero connections after174610ms.
  The 10-second demand write coalescer explains the shorter interval measured
  from the final external request. `demand-before-readiness.json` is historical.
- `operator-http.json`: actual anonymous local Convex health positive control,
  six public internal-mutation denials, identical before/after operations state.
- `native-startup.json`: exact valid bytes, Chromium native cold failure before
  readiness, and native-first success after the shared playable-window policy.
- `worker-artifact.json`: final worker/gateway/source hashes and actual readonly,
  nonroot owned-volume Docker image smoke. This is synthetic local capacity only.
- `firefox-launch.txt`: standalone browser launch fails before application load,
  including after installing Firefox150.0.2 and trying sandbox environment flags.
- Relay75/75, backend/proof73/73, native adapter/lineup33/33, tracked visual and
  controls18/18 passed. Final composed invocation had8 passes, three Firefox
  setup failures and one MSE retry failure; the focused MSE rerun passed33.6s
  after aligning bounded playlist retries with recovery. Aggregate invocation
  failure is preserved rather than relabeled green.

Screenshots were inspected with image viewing: player/controls fit both widths,
selected audio mode and refreshed DJ Lumen metadata are readable. The original
fixture selection remains DJ Aurora in the retained source label. No baseline
images were regenerated.

`production-artifact.json` records the successful compiled standalone check:
canonical logo traced and copied, anonymous neutral PNG200, derived PNG200
(12703bytes,512px), two authorization reads and one object read, then404 after
privacy eligibility changes. No repository docs fallback was available.
