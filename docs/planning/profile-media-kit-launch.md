# Profile Media Kit Launch Slice

## Status

Current recommendation for the first owner-usable profile media kit. This plan
was checked against `main` after PR
[#210](https://github.com/BASIC-BIT/VRDex/pull/210), issue
[#115](https://github.com/BASIC-BIT/VRDex/issues/115), the current Convex
schema, web routes, and checked-in AWS configuration.

This implementation can be merge-ready without being production-launch-ready.
A hosted upload/read/download smoke test and a bounded retained-storage cleanup
path remain launch gates. Owner gallery entry points and backend mutations stay
disabled unless `VRDEX_PROFILE_MEDIA_KIT_ENABLED=true` is set in both the web
and Convex runtimes. The source-preserving extension in
[#211](https://github.com/BASIC-BIT/VRDex/issues/211) has separate direct-upload
and accessibility-generation gates described below.

## Smallest Coherent Launch Slice

Locked decision:

- a signed-in owner of a claimed person or community profile can manage a small
  public image gallery
- the first gallery supports PNG, JPEG, WebP, and restricted safe SVG files
- an owner can accept the filename-derived title or replace it, and can add an
  accessibility description, caption, credit name, and credit link; reorder
  assets; select one featured image; replace an image; and soft-delete or
  restore an asset
- the public profile shows a calm featured-media treatment, an ordered gallery,
  individual downloads, and the existing logo ZIP when logos are present
- profile image, banner, and logo placements remain supported by the existing
  asset model; the launch editor manages gallery/featured placement and exposes
  other quota-consuming public assets for removal or restore
- video, audio, bulk DAM operations, collaborative roles, licensing workflows,
  automatic generation, and general-purpose agent behavior remain deferred;
  an explicit owner-triggered concise accessibility suggestion is the only
  generation path in this slice

Current recommendation:

- cap active assets at 12 per profile and each source object at 12 MB
- preserve the validated exact source as a private, no-store object; publish a
  full-resolution metadata-sanitized artifact in the same image format and a
  bounded WebP display derivative through controlled application routes
- strip raster metadata by decoding and re-encoding the public download, bound
  decoded dimensions, verify content independently of the browser-provided
  MIME type, and reject SVGs containing active or external content
- upload source files through a short-lived, exact-size/type-bound S3 POST into
  a quarantine prefix when `VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED=true`;
  Vercel completion reads and validates the private object without receiving
  the browser request body
- project only explicit `galleryAssets` placements with a title into the public
  gallery; preserve optional accessibility descriptions in that projection,
  keep the existing all-public-assets API, and require featured media to be a
  gallery item
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
| Upload | One-time Convex intents, token-gated web upload, private S3 writes, and HTTPS import exist | Use direct-to-quarantine upload with progress for source files that must not cross hosted request-body limits |
| File safety | Request byte bounds, MIME allowlist, SSRF-resistant imports, private bucket, and `nosniff` reads exist | Verify magic/content, re-encode rasters, strip EXIF, bound dimensions, restrict SVG |
| Metadata | Title, caption, accessibility description, and credit name exist | Add optional safe HTTP(S) credit link and upload/edit parity |
| Organization | Primary/additional logo placements and positions exist | Add gallery ordering and one featured placement |
| Visibility | Asset visibility and active/deleted states exist | Require gallery metadata before upload; completed launch uploads are public and draft/private storage is deferred |
| Preview and publish | Uploaded assets become public when an API intent is consumed | Choose the file and metadata before the explicit Publish action; use the public profile for the saved-state preview |
| Replace/delete/restore | Owner-only soft-delete and restore exist | Replacement uploads at the same position before removing the prior asset; a failed replacement leaves the prior asset public |
| Download/share | Individual controlled downloads and logo ZIP exist | `Download` returns the sanitized full-resolution original-format artifact; the stable profile page remains the share target |
| Public presentation | Public logo cards exist | Render the ordered gallery and featured asset, not logos only |
| Mobile and accessibility | Shared responsive primitives and profile visual coverage exist | Add labeled file input, live progress/status, keyboard reorder controls, meaningful image alternatives, mobile visuals |
| Error handling | API returns bounded upload errors | Surface unsupported, oversized, duplicate, retry, and storage-unavailable states for the single-file upload flow |
| Quotas/rate limits | API intent route is rate-limited to 30/minute | Add a 12-active-assets profile quota and a separate 1,200/minute public asset-file budget |
| Storage tenancy | Private bucket, per-intent random keys, Vercel OIDC role, Block Public Access, SSE-S3, controlled reads | No hosted storage variables are present in this local checkout; live provider readiness remains unverified here |
| Deletion/orphans | Soft-delete fields and quarantine lifecycle expiry exist | Physical deletion of retained source/derivative sets and post-write orphan reconciliation remain required operations |
| Moderation/abuse | Profile suppression gates public reads | Asset-specific reports, malware scanning, and moderator asset quarantine remain follow-up work |
| Telemetry/audit | Profile audit events exist for API upload | Record owner upload, metadata/order/featured, delete, and restore actions without filenames or private content |
| Cost/egress | Private S3 is checked in; reads currently use `private, no-store` | CDN/variants and cache policy need a measured follow-up before high traffic |
| Migration | Legacy avatar/banner URL fields remain supported as fallbacks | Existing URLs are not copied automatically; owner uploads can replace them deliberately |

## Complete Journey Map

1. The owner opens **Media kit** from Account or an owned profile row.
2. They choose a claimed person or community profile.
3. The editor lists gallery assets in public order, other quota-consuming
   public assets in a compact management section, and recoverable removed
   assets separately.
4. They choose an image and can accept its filename-derived title or replace
   it. Caption, credit name, credit link, and accessibility description are
   optional. `Generate` can return a concise editable accessibility suggestion;
   it never runs automatically and is not saved until Publish or Save.
5. The explicit Publish action creates an exact-size/type-bound direct-upload
   target, reports progress, and then asks the server to validate and publish
   the variants. A failed item remains available to retry without retaining an
   active quota reservation.
6. The owner can later update the title, accessibility description, caption,
   credit name, and credit link.
7. Up/down controls reorder the gallery without requiring drag gestures. A
   featured control selects the public lead image. New uploads append to the
   current order, and stale reorder snapshots fail without hiding newer items.
8. Removing an asset immediately hides it from public reads but keeps a Restore
   action. Uploading a replacement before removal avoids a broken public state.
9. The public profile presents the featured asset followed by the remaining
   gallery. Display images remain optimized derivatives; each `Download`
   returns the sanitized full-resolution artifact in the uploaded format.
   Logo placements retain the ZIP action.

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
- the editor's quota count uses the same active-public-asset set as backend
  admission, including profile images, banners, and logos outside the gallery.
- public asset delivery uses a separate `profile_asset_file` quota rather than
  consuming the shared anonymous API-read budget.
- SVG files are served only through the controlled application route and
  displayed as ordinary image resources, not inserted as inline markup. The
  validator rejects scripting, external references, and animation elements.
  Oversized animated raster sources are rejected before browser preparation so
  animation cannot be flattened into a still image.
  The route applies `nosniff` and a sandboxed content security policy with
  default, image, script, and object sources disabled; explicit downloads use
  attachment disposition.
- HTTPS imports pin a publicly resolved address and re-check redirects, ports,
  credentials, response size, and MIME.
- upload completion is server-only and atomically claims an intent before
  external fetch or image processing. Failed pre-write work releases the exact
  claim for at most three total processing attempts; active work cannot be
  cancelled concurrently, and claims abandoned for 10 minutes expire instead
  of being reassigned to the same storage target. Physical cleanup stays in the
  deferred reconciliation job for post-write failures.
- direct browser uploads land only under `profile-assets/quarantine/`. S3 CORS
  permits POST from the configured VRDex origins, the presigned policy binds
  exact content type and byte size, and an S3 lifecycle rule removes abandoned
  quarantine objects after two days.
- new assets keep three roles distinct: exact private source, sanitized
  full-resolution download, and optimized public display. Existing
  derivative-only records explicitly report that no source was preserved.
- accessibility generation accepts only a bounded raster preview, revalidates
  its content and dimensions server-side, uses low-detail model input, applies
  a five-second cooldown and rolling 20-per-day owner limit, and records only
  provider/model/result/size/latency/description-length metadata.

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

## #211 Pre-Enable Checklist

Do not enable the new paths until the target environment has passed each item:

1. Apply and review the `infra/terraform/profile-assets` CORS and quarantine
   lifecycle changes. Do not apply Terraform from application CI.
2. Confirm the staging asset variables point at an isolated staging bucket and
   role rather than production storage, then enable
   `VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED=true` in staging Vercel and
   Convex only. Run a synthetic PNG/JPEG/WebP smoke through direct upload,
   display, sanitized download, replacement, soft-delete, and restore. Confirm
   the downloaded MIME type and dimensions match the uploaded format while
   EXIF and location metadata are absent.
3. Promote `VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED=true` to production
   Vercel and Convex only after step 2. Without it, existing small multipart
   uploads remain the compatibility path.
4. For accessibility suggestions, first enable
   `VRDEX_PROFILE_MEDIA_ACCESSIBILITY_GENERATION_ENABLED=true` in staging
   Vercel and Convex, and set a staging `OPENAI_API_KEY` plus the optional
   `VRDEX_PROFILE_MEDIA_ACCESSIBILITY_MODEL` in Vercel. Verify owner denial,
   limit handling, timeout behavior, and content-free telemetry with synthetic
   media before promoting the same gate and production key separately.
5. Keep exact source keys private, inspect no real user media during smoke
   testing, and use synthetic assets only.
6. Before sustained production use, schedule reconciliation for consumed
   intents whose variant write/finalization did not complete and the existing
   30-day hard-delete policy for recoverable assets.

## Verification Plan

- backend tests for ownership, quotas, metadata bounds, ordering, featured
  uniqueness, soft-delete/restore, and public projection
- web security tests for content sniffing, dimensions, exact private source
  preservation, original-format metadata removal, WebP display generation,
  restricted SVG, mismatched types, and duplicate content
- backend tests for upload completion authorization, duplicate handling, and
  owner metadata/order/featured/remove/restore mutations
- browser assertions for upload/edit metadata parity, progress, generated-text
  editability, replacement failure safety, editor/public semantics, and desktop
  and mobile rendering; isolated fixture storage intentionally does not
  exercise hosted upload writes
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
