# Complete retained-image codec matrix

2026-10-27. These are unqualified synthetic encoder measurements, with one
observation per combination. The production measured allocation table remains
empty.

`reviewed-matrix.zip` is 2,612,312 bytes with 80 members. SHA256:
`a7091ce4e66d786c8c583b4f066637a2716d3bb4a9f7e704e19a8686efafe8dc`.
`retention.json` inventories every member. It retains the exact reviewed source,
all six original ranged responses, both complete reconstructed artifact copies,
their checks, provider source/build/cleanup records, and reproducible summary.
To rerun the archived summary script after extraction, set its `SOURCE` constant
to the extracted `actual/artifact-read-1.zip`.

The exact final source passed 166 local tests and independent whole-plan
SPEC/QUALITY review. Both artifact copies passed the independent result checker
with twelve completed executions. Runtime cleanup, including the owned XFS
directory, is closed. The test project, role, inline policy and log group were
deleted; two fresh provider censuses verified absence and a terminal build.

The record allowance was increased prospectively to 10 MiB after an earlier run
completed eleven cases but could not retain the final case. Its missing metrics
remain missing. The small-work allowance is 2 GiB within the unchanged 12 GiB
total. Root custody remains below 80 MiB. The archive retains the reviews and
arithmetic; these changes do not increase production capacity.

All twelve cases completed execution and all twelve measured post-warmup speeds exceeded real time. The lowest observed speed was 2.62x at 1080p60-aac320. Every case remains `incomplete` solely for `hidden_higher_ancestors`. No case failed, was censored, or is `not_run`.

| Preset | AAC160 speed | AAC320 speed | AAC160 peak MiB, FFmpeg / cgroup | AAC320 peak MiB, FFmpeg / cgroup |
| --- | ---: | ---: | ---: | ---: |
| 480p30 | 12.86x | 6.04x | 71.82 / 39.87 | 72.18 / 39.31 |
| 480p60 | 7.62x | 4.48x | 71.96 / 39.64 | 72.29 / 39.64 |
| 720p30 | 7.64x | 4.78x | 93.89 / 61.98 | 93.66 / 61.97 |
| 720p60 | 4.29x | 3.36x | 93.33 / 61.86 | 94.02 / 61.73 |
| 1080p30 | 4.44x | 3.15x | 135.69 / 104.01 | 135.84 / 103.87 |
| 1080p60 | 2.99x | 2.62x | 135.39 / 103.80 | 135.66 / 104.04 |

The largest available FFmpeg peak was 135.84 MiB at 1080p30-aac320 (142442496 bytes). The largest available child-cgroup peak was 104.04 MiB at 1080p60-aac320 (109096960 bytes). These measure different memory scopes and must not be added. FFmpeg peaks use wait4; cgroup peaks cover the whole run including the keeper.

CPU core equivalents are available for all twelve cases. CPU percentage is missing throughout because effective CPU entitlement is unknown. Observed child-cgroup throttled time was 0 seconds in all twelve measured cases. The CSV preserves source numerical precision and exact byte-to-MiB conversions; blank numeric fields mean missing, never zero. Its CPU-seconds/media-second column is derived as CPU core equivalents divided by speed only after confirming identical recorded measurement intervals and positive speed. It is a derived ratio, not a new qualified metric.

This is one observation per combination, with uncontrolled shared-parent contention and keeper overhead. The retained image is bound to baseline `db9abbcd59a30d206d85c0dcb2f407150e31dd9e` and was run in CodeBuild advertised as 4 vCPU and 7 GB. Archived host cpuinfo reports Intel Xeon Platinum 8488C. The child quota was 2 CPUs, restricted to CPUs 0 and 1, with 4 GiB memory. The workload generated 25 seconds of testsrc2 video and a synthetic tone, then encoded directly to MPEG-TS at `/dev/null`. It did not decode or downscale an input, exercise the full worker, or measure network/provider delivery. These observations do not qualify Fargate or the current image, establish statistical AAC cost, or justify a capacity increase. Hidden higher cgroup ancestors prevent a complete effective-entitlement assessment.

Source: archived `result.json` and `host.json` in `artifact-read-1.zip`, SHA-256 `a81ba4b8112ad84c6ec536b06385a542effce4378161a5e4fa27ff483f78f940`. Extraction and interval checks are reproducible with `extract_summary.py`; `provenance.json` records their results.
