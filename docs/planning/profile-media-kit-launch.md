# Profile Media Kit Launch Slice

## Status

Current recommendation for the first owner-usable profile media kit. This plan
was checked against `main` after PR
[#194](https://github.com/BASIC-BIT/VRDex/pull/194), issue
[#115](https://github.com/BASIC-BIT/VRDex/issues/115), the current Convex
schema, web routes, and checked-in AWS configuration.

This implementation can be merge-ready without being production-launch-ready.
A hosted upload/read/download smoke test and a bounded retained-storage cleanup
path are launch gates. Owner gallery entry points and backend mutations stay
disabled unless `VRDEX_PROFILE_MEDIA_KIT_ENABLED=true` is set in both the web
and Convex runtimes.

## Smallest Coherent Launch Slice

Locked decision:

- a signed-in owner of a claimed person or community profile can manage a small
  public image gallery
- the first gallery supports PNG, JPEG, WebP, and restricted safe SVG files
- an owner can add a short title, accessibility description, caption, and
  credit; reorder assets; select one featured image; and soft-delete or restore
  an asset
- the public profile shows a calm featured-media treatment, an ordered gallery,
  individual downloads, and the existing logo ZIP when logos are present
- profile image, banner, and logo placements remain supported by the existing
  asset model, but the launch editor focuses on gallery and featured placement
- video, audio, bulk DAM operations, collaborative roles, licensing workflows,
  and AI-generated metadata remain deferred

Current recommendation:

- cap active assets at 12 per profile and each source object at 12 MB
- keep source objects private and serve public assets only through the existing
  controlled application route
- strip raster metadata by decoding and re-encoding uploads, bound decoded
  dimensions, verify content independently of the browser-provided MIME type,
  and reject SVGs containing active or external content
- project only explicit `galleryAssets` placements with a title and
  accessibility description into the public gallery; preserve the existing
  all-public-assets API, and require featured media to be a gallery item
- keep deletion recoverable in Convex for this slice; physical object deletion
  follows a documented retention and orphan-cleanup job rather than happening
  synchronously in an owner request
- before enablement, cap retained storage per profile at 24 source objects and
  288 MB across active, deleted, pending, expired, and reconcilable orphan
  states; reconcile expired/orphaned objects within 24 hours and physically
  remove soft-deleted objects after a 30-day recovery window

## Existing Capability And Gaps

| Journey or control | Verified current capability | Launch gap or disposition |
| --- | --- | --- |
| Eligibility | `profileOwners` and claimed-profile checks exist for API uploads | Add browser mutations that use the same owner check |
| Entry points | Account lists owned profiles; public profiles render media-kit logos | Add Account and owned-profile media-kit links |
| Upload | One-time Convex intents, token-gated web upload, private S3 writes, and HTTPS import exist | Add owner UI and target-profile intent creation |
| File safety | Request byte bounds, MIME allowlist, SSRF-resistant imports, private bucket, and `nosniff` reads exist | Verify magic/content, re-encode rasters, strip EXIF, bound dimensions, restrict SVG |
| Metadata | Loose label and caption fields exist | Add accessibility description and credit |
| Organization | Primary/additional logo placements and positions exist | Add gallery ordering and one featured placement |
| Visibility | Asset visibility and active/deleted states exist | Require gallery metadata before upload; completed launch uploads are public and draft/private storage is deferred |
| Preview and publish | Uploaded assets become public when an API intent is consumed | Choose the file and metadata before the explicit Publish action; use the public profile for the saved-state preview |
| Replace/delete/restore | Schema has soft-delete fields but no owner mutations | Add owner-only soft-delete and restore; replacement is upload then delete |
| Download/share | Individual controlled downloads and logo ZIP exist | Keep stable profile page as share target; no separate share-token system |
| Public presentation | Public logo cards exist | Render the ordered gallery and featured asset, not logos only |
| Mobile and accessibility | Shared responsive primitives and profile visual coverage exist | Add labeled file input, live progress/status, keyboard reorder controls, meaningful image alternatives, mobile visuals |
| Error handling | API returns bounded upload errors | Surface unsupported, oversized, duplicate, retry, and storage-unavailable states for the single-file upload flow |
| Quotas/rate limits | API intent route is rate-limited to 30/minute | Add 12-active-assets profile quota; retain the existing request limit |
| Storage tenancy | Private bucket, per-intent random keys, Vercel OIDC role, Block Public Access, SSE-S3, controlled reads | No hosted storage variables are present in this local checkout; live provider readiness remains unverified here |
| Deletion/orphans | Soft-delete fields exist | Physical deletion, expired-intent cleanup, and orphan reconciliation are required before enabling hosted uploads for real users |
| Moderation/abuse | Profile suppression gates public reads | Asset-specific reports, malware scanning, and moderator asset quarantine remain follow-up work |
| Telemetry/audit | Profile audit events exist for API upload | Record owner upload, metadata/order/featured, delete, and restore actions without filenames or private content |
| Cost/egress | Private S3 is checked in; reads currently use `private, no-store` | CDN/variants and cache policy need a measured follow-up before high traffic |
| Migration | Legacy avatar/banner URL fields remain supported as fallbacks | Existing URLs are not copied automatically; owner uploads can replace them deliberately |

## Complete Journey Map

1. The owner opens **Media kit** from Account or an owned profile row.
2. They choose a claimed person or community profile.
3. The editor lists active assets in public order and a separate recoverable
   removed section.
4. They choose an image and add the required title and accessibility
   description plus optional credit before publishing. Client checks provide
   quick type/size feedback; server validation remains authoritative.
5. The explicit Publish action starts the upload. Progress and a status
   announcement remain associated with that file, and a failed item remains
   available to retry without retaining an active quota reservation.
6. The owner can later update the title, accessibility description, caption,
   and credit.
7. Up/down controls reorder the gallery without requiring drag gestures. A
   featured control selects the public lead image.
8. Removing an asset immediately hides it from public reads but keeps a Restore
   action. Uploading a replacement before removal avoids a broken public state.
9. The public profile presents the featured asset followed by the remaining
   gallery. Each item has a controlled download; logo placements retain the ZIP
   action.

Empty, loading, storage-unavailable, unsupported-type, oversized-file,
duplicate-file, quota, and network failure states must be direct and
actionable. The editor uploads one file at a time and must not claim that a
failed upload is saved.

## Safety And Operations

Verified:

- Terraform defines the private bucket, Block Public Access, SSE-S3, narrow
  object-prefix access, and Vercel OIDC role/config names.
- Local runtime configuration does not currently contain any profile-asset
  bucket or region variables. This work can validate isolated fixture behavior,
  but it cannot claim a live upload environment is ready.
- the owner gallery is disabled by default in both the web and Convex runtimes;
  enabling it requires an explicit environment change after the launch gates
  pass.
- public object delivery rechecks profile readability, asset state, visibility,
  and profile tenancy before reading S3.
- editor previews use a separate signed-in owner route, recheck current profile
  ownership, and remain private/no-store instead of weakening public delivery.
- SVG files are served only through the controlled application route and
  displayed as ordinary image resources, not inserted as inline markup. The
  route applies `nosniff` and a sandboxed content security policy with scripts
  and objects disabled; explicit downloads use attachment disposition.
- HTTPS imports pin a publicly resolved address and re-check redirects, ports,
  credentials, response size, and MIME.
- upload completion is server-only; physical cleanup stays in the deferred
  reconciliation job so concurrent idempotent retries cannot delete a winner's
  object.

Follow-up risks:

- add a scheduled cleanup process for expired intents, unconsumed objects, and
  soft-deleted objects with the retained-storage cap and deadlines above; do
  not enable hosted uploads for real users until automated tests and a real
  non-production staging exercise prove those controls
- choose malware-scanning and asset-report/quarantine behavior before accepting
  higher-risk media formats or broad anonymous submissions
- measure download egress and decide on controlled caching/variants or a CDN
- add license/rights metadata only after real operators establish the useful
  fields and moderation policy
- decide whether private/draft media should exist; the first owner gallery is a
  public profile feature, not a general file vault

## Verification Plan

- backend tests for ownership, quotas, metadata bounds, ordering, featured
  uniqueness, soft-delete/restore, and public projection
- web security tests for content sniffing, dimensions, raster metadata removal,
  restricted SVG, mismatched types, and duplicate content
- backend tests for upload completion authorization, duplicate handling, and
  owner metadata/order/featured/remove/restore mutations
- browser assertions for editor/public semantics plus desktop and mobile
  rendering; isolated fixture storage intentionally does not exercise hosted
  upload writes
- exact desktop and mobile screenshots of the synthetic owner editor and public
  gallery, followed by independent correctness and taste review

## Unified Search Coordination

PR #194 owns public search queries, projections, cards, view state, and their
tests. The combined head preserves its compact-image selection contract while
adding gallery fields to the shared profile projection. Account navigation,
synthetic fixtures, backend wiring and tests, and person-profile visual
baselines were reconciled after #194 merged.

The separate Persona/JTBD proposal also recommends one reusable asset system
for people and communities and a stable compact Search projection. That
proposal still awaits BASIC review; this slice does not treat its contract or
any proposed public copy as approved.
