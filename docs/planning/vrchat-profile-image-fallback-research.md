# VRChat profile image fallback research

Date: 2026-09-08. Historical research snapshot. The final approved design supersedes the
recommendations below: communities are included, current-avatar images are excluded, and
saved link order supplies a default before owner selection. See the
[implementation plan](../superpowers/plans/2026-09-09-profile-image-fallback.md) and
[current behavior](../backend/profile-schema.md#automatic-profile-images).

## Findings from current source

The existing destination resolver already collects a usable portrait URL for a VRChat user. Its priority is `profilePicOverrideThumbnail`, `profilePicOverride`, `currentAvatarThumbnailImageUrl`, then `currentAvatarImageUrl`. This is our implemented choice, not an assertion that VRChat guarantees this precedence. It stores one selected source URL, so the original full-size alternative is not retained when a thumbnail wins. [Resolver](../../workers/group-telemetry/profile-link-destination.mjs)

Destination artwork is sanitized and rehosted through a separate cache. The current output is a small square thumbnail intended for link buttons. A main profile portrait should have a larger derivative and prefer the full-size version of the selected portrait rather than enlarge the link thumbnail. A derivative size must participate in the cache identity to avoid serving an old small image after changing the transform. The cache currently keys on destination, kind, and source URL. [Transform](../../apps/web/src/lib/server/profile-link-destination-artwork.ts), [cache](../../apps/web/src/lib/server/profile-link-destination-artwork-cache.ts)

The person profile page currently selects the managed profile-image placement, then legacy `avatarImageUrl`. It does not use destination metadata. Community profiles have different logo precedence, so this should begin with people only. [Public profile projection](../../convex/profiles.ts)

Image selection also exists independently in search, event participants, share cards, and owner preview. Search enriches indexed results with managed media and otherwise uses the indexed image, whose legacy fallback can be the banner. Share cards intentionally use discovery visibility and accept raster media. Consequently, changing only the main profile projection will not produce consistent avatars elsewhere. [Search](../../convex/_searchDocuments.ts), [event participants](../../convex/_eventPublic.ts), [share cards](../../convex/_profileShareCard.ts), [owner media preview](../../convex/profileAssets.ts)

Verified connections and ordinary outbound links are distinct data. Connections expose `linkRole` (`primary` or `secondary`) and compute verification from currently active, unexpired control proofs. A connection can survive expiration of its proof. A public VRChat link therefore must not silently acquire a verified badge just because it provides an image. There is no primary flag in ordinary outbound-link presentation. [Connections](../../convex/profileConnections.ts), [outbound-link projection](../../convex/_profilePublic.ts)

Metadata collection and artwork authorization currently depend on an exact public outbound-link reference. A verified connection without that outbound link neither enters this destination queue nor passes the artwork endpoint's authorization check. Selecting an automatic image from primary connections therefore requires including the selected identity in collection/reference authorization, or explicitly limiting the first version to matching public links. Reusing the existing cache alone does not solve identity selection. [Queue and projection](../../convex/_profileLinkDestinationCache.ts), [artwork authorization](../../convex/profileLinkDestinations.ts)

## Visibility and freshness

The app distinguishes direct profile-page visibility from discovery visibility. An unlisted avatar or outbound link may appear on the direct profile page but must not be projected into search or social share cards. A fallback must check the visibility of the avatar and its selected identity source for the requested surface. A missing value after visibility filtering is not evidence that the person has not set an image. [Visibility rules](../../convex/_profileFieldVisibility.ts), [managed-media visibility](../../convex/_profileAssets.ts)

The current artwork endpoint authorizes against `profile_page` visibility. Any reuse for discovery should perform discovery checks before exposing the URL in those projections, and should account for subsequent visibility changes rather than depend on a stale search document alone. [Artwork route](../../apps/web/src/app/api/profile-link-artwork/[key]/route.ts)

The current metadata queue refreshes on demand: new public links, or actual profile visits when stale after 24 hours. Failed lookups become eligible after their cooldown but do not automatically retry. Search and previews do not initiate provider lookup. The artwork cache separately refreshes cached bytes after 24 hours when requested and suppresses repeated failed imports for one hour. Existing bytes can be used on an import failure. These are distinct caches and neither implies an immediate avatar update when the person changes their VRChat appearance. [Metadata queue](../../convex/_profileLinkDestinationCache.ts), [artwork cache](../../apps/web/src/lib/server/profile-link-destination-artwork-cache.ts)

## Decisions and recommendations

- Accepted in the parent design conversation: allow an unverified primary VRChat identity to supply the fallback; retain an explicit no-image choice. Using the image is not verification.
- Current recommendation: people only, consistent across ordinary profile/avatar surfaces, with existing authored images taking precedence and visibility respected everywhere.
- Current recommendation: preserve demand-driven collection. A cache miss shows the existing placeholder and never blocks rendering or creates a recurring poller.
- Current recommendation: keep fetched metadata separate from authored profile media. Do not write the fetched URL into `avatarImageUrl` or pretend it is an uploaded Media Kit asset.
- Current recommendation: prefer the custom VRChat portrait, then avatar artwork, using full-size source variants for a larger cached derivative. Continue using the small derivative for link buttons.
- Design detail to resolve during implementation planning: how an unclaimed profile with several ordinary VRChat user links selects one identity when it has no primary connection. Do not rely on arbitrary list order without an explicit rule.

Implementation should centralize effective person-avatar selection while preserving each surface's existing logo, banner, and visibility behavior. Meaningful verification includes authored override, explicit no-image, no cached portrait, multiple identities, primary identity change, private/unlisted fields, expired proof, and stale-cache failure. Search and share cards need direct checks in addition to the main page.
