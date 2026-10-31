# Current-image smoke publication review

**SPEC: PASS. QUALITY: PASS. No outstanding findings in the scoped publication.**

Reviewed only `docs/engineering/authority/reviews/current-image-smoke/{README.md,retention.json,reviewed-results.zip}` and the appended October 28 section in `docs/engineering/event-broadcast-quality-capacity.md`. No broad branch re-review, tests, provider operations or media reads were performed. Only this review report was written.

## Addressed findings

Two wording findings at `current-image-smoke/README.md:16` are resolved in the final inspected text:

1. Removed the claim that both private downloads matched ETag. Both archived custody records retain `etag:null`; the publication now claims only the retained length/SHA-256 agreement. Original metadata was preserved rather than populated retrospectively.
2. Removed the monotonic-DTS claim. The retained independent packet summary contains 1,537 packets, maximum gap 0.033334 seconds and maximum GOP 1 second, but no explicit monotonicity result or packet inventory. The final row reports exactly those retained metrics. Root's separately reported execution assertions are not promoted into additional archive evidence.

No remaining correction is requested.

## Verification and scope

Independently verified archive length 188,783 bytes and SHA-256 `d477825f02cb861c26f5795a186ff3e817bdd47d93b06dc5b56c2b91583765c0`, its exact 71-member inventory, ZIP integrity, and every member's complete length/SHA-256 against `retention.json`. The archive remained unchanged after the wording correction.

All 134 actual/expected packaged-source hashes match Git revision `69e5622a92a1dff05be66abdcf7674a71c482ad1`. Image identity/version records agree with the README. All eight retained tasks use the stated immutable digest and 4096 CPU/8192 MiB allocation; the final census records eight STOPPED tasks, eight INACTIVE definitions, no ENIs and no running cluster tasks. The recorded ECR lifecycle retains 20 images. Compute arithmetic and the stated estimate/reservation limits agree with the retained summary.

The two complete native receipt copies agree in body length/hash and contain all 42 Python and 90 Node named passing outcomes. The two complete successful Twitch receipt copies likewise agree and match the standalone retained receipt. That receipt supports two observed 1920×1080 input dimensions, requested input profile distinct from observed frame rate, H.264 720p30/AAC 48 kHz stereo output, successful take/cut/return acknowledgements and advancing output checkpoints, approximately 20 seconds of private recording, and the disclosed source-retirement/reacquisition readiness loss. The independent custody summary supports two complete 5,484,148-byte copies with identical SHA-256 and AES256; no media was opened for this review.

The VRCDN originals support `basicbit1` publisher progress of 60,010 ms/eight commands and successful playback codec headers. They separately preserve `basicbit` publication rejection and the unrelated/unverified-origin 720p60 playback observation. Initial Twitch failures and resolver probes remain explicit negatives alongside the final successful pair; their failure receipts are not reclassified as successes.

All archive members are text JSON, Markdown, JavaScript, Python or revision text. Inspection and scoped scans found no media, signed download URLs, AWS credential values, private keys, bearer credentials or injected ingest-secret values. Provider resource identifiers and secret references are metadata, not secret values. This is an inspection conclusion for these exact members, not a universal sanitizer claim.

The README and appended capacity section consistently retain the important limits: private short diagnostic, synthetic VRCDN codec smoke without content/freshness proof, unresolved rejected account, disabled full relay switch, empty production allocation map, and no capacity/production-admission, automatic silence/death handoff, sustained soak, source-marker or physical-device acceptance claim. No new validation is required for this factual publication.
