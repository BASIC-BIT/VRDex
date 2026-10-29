# Now Playing metadata and artwork

The retained root playback owner publishes Media Session metadata from admitted
`PlaybackSnapshot.metadata`. A performer sequence uses installed `lineup.current`
to locate its profile artwork route. Prepared performers, selected manual targets
awaiting admission and scheduled successors do not supply identity. Healthy
overtime retains the current DJ. The raw authoritative display name supplies the
exact title `<DJ display name> - VRDex`; request titles are already formatted and
must not be formatted again. An authorized event stream without a DJ association
uses its event title and no DJ artwork. Absent installed metadata clears the OS
metadata. Metadata refresh changes no connection or grant.

The existing provider is the only Media Session owner. Play, Pause and Stop
handlers capture its generation and check that it still has a request. Play
passes through the retained owner's existing admission, calendar and foreground
ownership fences. Stop closes playback and clears metadata and handlers. Close,
revocation and installed-source release clear metadata independently of a pending
selected target. Video and Audio only retain the same current identity.

## Authorized image delivery

Revision-specific artwork uses the existing public asset file route with
`revision` and `brand` query parameters. Its profile locator is the public slug.
Each network fetch checks current profile publication, field visibility, active
public asset ownership, selected profile-image/logo eligibility and exact source
revision before consulting the derivative cache. A discovery-authorized image
still must pass the profile-page file route's policy; this never widens that
policy. Legacy remote images and arbitrary URLs are not image sources.

The source remains untouched. Sharp normalizes a static raster into a 512x512 PNG
and overlays the approved `docs/brand/wordmark/vrdex-wordmark.png` at 160px width,
18px from the lower and right edges. The renderer accepts PNG, JPEG and WebP,
limits source bytes to 12 MiB and decoded pixels to 4096x4096, and limits output
to 1 MiB. Each server instance serializes rendering, admits at most eight queued
requests, and retains at most 128 derivatives or 32 MiB. Concurrent requests for
the same source reuse the completed bytes. This is a shared server derivative,
not a viewer-specific rendering. Cache eviction or a cold instance can rerender
the same deterministic source revision and brand recipe.

The cache identity includes profile locator, asset ID, source revision, storage
key and `wordmark-v1-512` brand recipe. Update the brand version whenever the logo
or rendering recipe changes. The selected source revision comes from its stored
`updatedAt`, matching the admission metadata projection. Old and new revisions
have different URLs; a fresh request for an old revision fails after replacement.

Success responses use `private, max-age=31536000, immutable`; denied derivative
responses use `private, no-store`. A shared CDN must never serve these private
responses around current authorization. Already downloaded browser-private bytes
cannot be erased after a profile is hidden. Every subsequent network fetch must
pass current authorization, even if server derivative bytes are cached.

## Packaging and acceptance

`apps/web/next.config.ts` explicitly includes the canonical PNG in file tracing
for the public asset route. Runtime reads the traced `docs/brand/wordmark` path
from the repository/standalone root, or two directories above an `apps/web`
working directory. Sharp is a direct web runtime dependency. Local route tests
exercise the actual GET handler with local authorization/storage fixtures and
real Sharp bytes, including an anonymous cold HTTP image fetch and denial after
visibility or revision changes with a populated cache.

Production Next/Vercel output packaging still needs a built-artifact check:
inspect the route's `.nft.json` for the canonical PNG, then fetch the derivative
from that packaged server with its actual launch working directory. The focused
source tests and trace configuration do not establish this deployment check.

Physical iPhone Safari must independently verify cold artwork fetching, screen
lock and Dynamic Island presentation, native Resume/Pause/Stop and identity
transitions. Desktop HTTP, Chromium and viewport checks do not establish those
results. iOS controls the layout; this feature does not create a Live Activity.
