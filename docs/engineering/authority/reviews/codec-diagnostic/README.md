# Retained codec diagnostic checkpoint

2026-10-27. This checkpoint fixes test setup and preserves a real CodeBuild
result. It contains no completed encoding measurements and admits no production
allocation.

`reviewed-source-and-run.zip` is 322,084 bytes with 48 members. SHA256:
`ba939ae242f15192d3f1978133d77dae450f27ebe2e0d9c78596759564501fb0`.
`retention.json` records every member's length and SHA256. The archive contains
the reviewed diagnostic source, tests, review dispositions, both complete
artifact copies and their checks, and provider cleanup records.

## Verified setup changes

The diagnostic keeps its short Unix socket paths under `/tmp/cd`. Docker image
data uses a separately owned directory on the observed XFS mount under
`/codebuild/output`. Docker must report `overlay2`, the expected data directory,
XFS and d_type support before loading the image. There is no driver fallback.
Both owned directories share the existing scan, disk and work limits, and both
participate in cleanup verification.

The monitor now reports entry-limit and elapsed-time failures separately. It
uses `scandir` while retaining per-observation accounting. Independent review
caught and corrected a batching regression before live use. Storage review also
caught and corrected rejection of a safely closed partial-setup negative.

The final storage implementation passed 145 tests. Its subsequent checker-only
correction passed 24 focused storage tests and four direct checker cases.
Independent source and correction reviews passed; the archive retains the
original findings as well as their dispositions.

## Actual run and remaining blocker

Build `codec-diagnostic-1566fc5f1035405c993629fd6fa8537e:5081b1ff-bb5d-469f-81e2-bb332f341280`
loaded the retained worker image using Docker 24.0.9 and overlay2 on XFS. Peak
observed owned allocation was 3,400,585,216 bytes. The last scan covered 53,091
entries in 0.229 seconds, below the unchanged 100,000-entry and 0.8-second limits.

The first child reached READY, then stopped with `resource_control_unproven`
before encoding. The parser expected the parent ECS cgroup mount shape; the
nested Docker child exposes a narrower mount beneath it. One cell is incomplete
and eleven did not run. Both complete artifact reads independently pass the
result checker. Their ZIP SHA256 is
`6f79ad006abfe5e4f2fa619b1aa7ffd99c52b0419cbc3b5a284603894969b188`.

Runtime cleanup is closed, including removal of the owned XFS directory. The
project, role, inline policy and log group were deleted, and two fresh provider
censuses confirm absence and a terminal build. Temporary test resources are not
left running.

The next task is the child-view mapping fix followed by a fresh run. Even a
completed synthetic codec matrix will remain diagnostic: it uses the retained
`db9abbcd` image and requests two child CPU cores and 4 GiB. It does not test
the changed production worker on Fargate. Current-image, decode/downscale, complete worker, provider
and capacity qualification remain separate obligations. The production measured
allocation table remains empty.
