# Profile link destination names

Status: design agreed on 2026-09-08, including Q10 visual treatment, and subsequently implemented at the user's request. Local tests, typechecks, visual checks, and spec/standards review pass. Deployment is a separate step.

## Problem

Multiple outbound links can render identical generic labels. The user supplied a profile screenshot with three separate VRChat group buttons all labelled VRChat group. A reader cannot distinguish their destinations without opening them.

## Locked decisions

The user accepted Q1-Q8 on 2026-09-08, explicitly expanded Q9 to include destination artwork in the first version, and accepted Q10's compact visual treatment:

- Show the actual destination name as the main label, with a smaller platform/type indicator. VRChat people, VRChat groups, and Discord servers must remain distinguishable.
- Default to the fetched name. Profile owners may optionally provide a custom label and reset it to the current fetched name.
- Store authored labels separately from fetched destination metadata.
- Initial scope: VRChat people, VRChat groups, and Discord server invites. Other providers retain their existing behavior.
- Automatic names follow provider renames through roughly daily cached refreshes. Owner overrides remain unchanged. Rendering a profile does not wait for a provider lookup.
- Temporary lookup failures retain the last known name. Never-resolved links use the platform/type plus a short destination identifier so multiple links remain distinguishable.
- Gradually resolve existing published links as well as new links. Replace recognizable generated labels, preserve distinct custom wording, and leave ambiguous legacy labels alone.
- Flag confirmed invalid or expired links in the editor without silently deleting them. A changed destination invalidates the old metadata association and requires a fresh resolution.
- Apply the same naming rules to public profiles, editor previews, and lookup results. API consumers retain access to the original URL and separate fetched metadata.
- Include destination artwork in this version: VRChat group icons, VRChat person imagery, and Discord server icons where available. Deferring artwork was explicitly rejected.

## Current code findings

- The generic link renderer uses the existing outbound link label directly (`apps/web/src/app/_components/profile-public-page.tsx`).
- Link normalization supplies a generic provider label when none was entered (`convex/_profileLinks.ts`). Existing labels therefore do not reliably distinguish intentional author wording from generated defaults.
- The editor only exposes custom label inputs for generic/custom-site link types (`apps/web/src/app/_components/profile-fields.tsx`). Provider-name overrides would need explicit editor support.
- The public profile currently interprets a non-generic Discord label as a personal handle when no handle is provided. A fetched server name must not enter that path. Destination kind must be explicit enough to preserve invite navigation and personal contact copying.

## Proposed experience

Locked decision: the user accepted the compact, static destination-artwork treatment in Q10. Exact dimensions remain implementation tuning:

- Keep compact link controls. Put a small destination thumbnail beside the name, with platform/type secondary to the name. Do not turn the Links section into a grid of large image cards.
- Use a fixed-size, subtly rounded thumbnail slot (approximately 32px). Artwork loading or failure must not resize the control or delay its text or click target.
- Let long names wrap within the control without pushing copy/link controls outside the mobile viewport. Keep the complete destination name available to assistive technology.
- Prefer static artwork in this slice. An animated provider icon uses a static representation; the link list should not become a collection of autoplaying images.
- Missing, inaccessible, or failed artwork falls back to the platform/type icon in the same slot. The destination name remains visible. No broken-image glyph or viewer-facing diagnostic copy.
- Use provider-supplied artwork for the actual destination. Custom label overrides do not change the artwork's source. A separate image-upload/override feature is not part of this proposal.
- Treat thumbnails as decorative where the adjacent text names the same destination. Keep the whole control keyboard-operable and preserve the existing external-link behavior.

## Data and resolution requirements

- Distinguish destination kind from the broad link provider, including VRChat user, VRChat group, Discord guild invite, and Discord personal contact. Name enrichment must never convert a server invite into a copied personal handle.
- Retain the authored URL. Store its resolved provider/entity ID separately; resolve by exact identifier rather than a fuzzy name search. A Discord invite code is a locator whose target may change, not a permanent guild ID.
- Keep a minimal metadata projection: resolved name, artwork reference, provider/entity identity, observation time, and resolution status. Keep owner label overrides and their provenance separate.
- Share public metadata by stable destination identity where appropriate, but track each invite's binding and validity separately. A reassigned code must not retain the previous server's name or image.
- Schedule bounded asynchronous lookup on link creation/change and gradual existing-link refresh. Cache and reuse results across public renders. Honor provider retry instructions and rate limits; use jitter for refreshes.
- A new metadata observation must not overwrite profile aliases, handles, provenance, ownership proofs, or verification state. Fetched branding is not proof that the profile owner controls that destination.
- Preserve existing profile and link visibility checks before enrichment. Do not expose data obtained only through private group membership or a user's private guild-management list.
- A transient error may retain last-known names/artwork. Confirmed removal or loss of public visibility must not be treated as a successful cached observation. Confirmed invalid invite state belongs in the editor; the public link is not silently deleted.
- Bound any artwork fetch, redirect, decoding, and cache behavior using the existing remote-image import boundary where suitable. Do not turn arbitrary user URLs into an unrestricted image proxy. Images must render without provider credentials in the browser.
- Candidate artwork delivery: sanitize a small raster thumbnail into VRDex storage and serve it locally, reusing bounded import and validation primitives rather than the whole media-kit publishing workflow. Use a bounded cache lifetime that permits removal, not an immutable annual cache for a mutable destination URL. Resolve the actual provider portrait/icon field through adapter evidence before fixing its priority in code.

## Legacy handling

- Inventory the exact labels emitted by existing normalizers and importers, including generic VRChat group labels, before rewriting existing values.
- Do not infer that every nonempty label was written by an owner. Preserve ambiguous values and provide an explicit reset to automatic naming.
- Metadata refresh applies to supported public links regardless of whether the VRDex profile is claimed. Existing permissions continue to govern authored edits; enrichment adds no editing authority or verification badge.
- Unsupported Discord channel/user URLs remain functional with their existing or custom labels. They must not be looked up as public guild invites or require new user permissions solely for link decoration.

## Acceptance cases

1. Three different valid VRChat group links show three group names and corresponding artwork, with a secondary VRChat group indication. Each opens its original target.
2. A VRChat person link displays the person's display name and supported profile imagery, distinguishable from a group link.
3. A valid Discord guild invite shows the server's name/icon and remains an invite link. Personal Discord contacts still retain their existing copying behavior.
4. An owner can override a fetched label and reset it to automatic naming. Provider renames update automatic labels without overwriting custom labels.
5. Slow or failing providers do not block page rendering or saving a valid link. Temporary failures retain usable cached metadata; never-resolved targets remain distinguishable.
6. An expired invite is visible as a problem in the editor. A code resolving to a different guild drops both the old name and artwork association before displaying the new destination.
7. Missing/failed artwork leaves a stable platform fallback with the name readable. The control remains usable on desktop, mobile, and keyboard navigation.
8. Existing profiles benefit without requiring owners to re-enter links. Distinct/ambiguous legacy labels survive the migration.
9. Public profile, unsaved preview, and lookup agree on destination identity and label precedence. API fields keep authored inputs distinct from observed provider data.
10. Tests prove no name/image enrichment bypasses private-field filtering, implies control verification, fetches arbitrary origins, or mixes one destination's metadata into another.

## Design agreement and implementation evidence

The user confirmed Q10 on 2026-09-08: a compact control with static destination artwork, the actual name as primary text, smaller platform/type text, a platform icon fallback, and names that wrap on mobile. Artwork comes from the destination; custom text labels remain editable. The design interview is complete, with no remaining product questions. The subsequent implement request authorized the local implementation.

Implementation evidence: unauthenticated Discord invite lookup returned the public VRChat server name/icon. A public VRChat image exercised the real signed redirect and produced a sanitized static 128px WebP. Controlled responses cover names, privacy, failures, and destination replacement. Desktop and 390px mobile previews were visually inspected, including long names and unavailable artwork. The 2026-09-08 authenticated BASICBIT response confirmed a distinct profile-picture override thumbnail and avatar. Its `/api/1/image/file_<UUID>/<version>/512` endpoint redirects to a signed thumbnail CDN URL. The rollout correction accepts those exact bounded paths and produced a static 128px WebP (2,648 bytes) through the real importer. Regression tests cover override precedence, signed redirects, and rejected URL variants.

The cache/runtime behavior is documented in [Profile schema](../backend/profile-schema.md#outbound-destination-metadata). Deploying this change requires the web application, Convex functions, collector capability update, and thumbnail lifecycle configuration; local implementation does not deploy them.

Research companion: [Profile link display names research](profile-link-display-names-research.md).
