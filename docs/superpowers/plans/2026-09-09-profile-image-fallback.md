# Profile image fallback implementation

Approved design: uploaded images retain priority. An explicit fallback-off choice suppresses automatic images. People use custom VRChat profile pictures only, never current-avatar artwork. Communities use the selected VRChat group, then selected Discord server. Without owner selection, use the first eligible destination in saved link order, including unclaimed communities. Respect image and source visibility on each surface. Refresh through existing demand only.

Implementation boundaries:

1. Destination resolver and cached image route: add portrait provenance, suppress legacy unproven user artwork, support a versioned 512px derivative. Existing cached avatar artwork must no longer be served. Validate through resolver and image route/cache tests.
2. Central automatic image selection: use existing public outbound destinations, prefer a primary VRChat connection when it matches a public link, preserve authored/hidden media. Attach an automatic image URL separately from uploaded assets. Validate through public profile queries, artwork authorization and settings mutations.
3. Project the same fallback into profiles, discovery, event participants, previews and social cards. Read cached metadata only on discovery. Validate privacy and authored precedence.
4. Owner controls in Media Kit: Automatic/No image and community source selectors. Validate selection authorization and visually inspect the UI.
5. Update docs, run typechecks and focused tests during implementation, full suites at the end, then standards/spec reviews against 5c153815a66a43b96f93fc0f8b402982720c1e2c. Commit and open a PR. Deployment is separate.

No new public prose beyond utility labels. No new background sweeps, external API calls from rendering, or media uploads masquerading as owner content.

## Verification

Implemented on `codex/profile-image-fallback`. Backend suite: 776 passing. Web suite: 453
passing. Collector suite: 49 passing. Backend code generation, backend/web typechecks,
web lint, Markdown lint and production web build passed. Actual controls were checked in
Chromium at desktop/mobile sizes with mocked Convex hooks: seven interaction checks passed,
no browser errors or mobile overflow. This is local verification, not deployment evidence.

Independent spec review found no blocking mismatch. Standards review found a stale removed
source could block settings saves; normalized returned settings and a failing-then-passing
public mutation/query regression resolve it. The reviewer confirmed the fix.
