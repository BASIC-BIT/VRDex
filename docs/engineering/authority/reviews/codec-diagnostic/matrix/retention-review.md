# Final matrix retention review

SPEC: **PASS**. QUALITY: **PASS**. Blocking findings: **none**.

This review covers the final retention diff against public checkpoint `2a3a901`,
including the matrix archive, inventory, CSV, README and historical/quality-page
links. The prior whole-plan source verdict remains applicable: the source is
unchanged. No test suite, result checker, provider operation or native workload
was rerun.

## Retention and source identity

Independent read-only hashing verified `reviewed-matrix.zip`: 2,612,312 bytes,
80 unique members, 3,546,627 logical bytes, SHA256
`a7091ce4e66d786c8c583b4f066637a2716d3bb4a9f7e704e19a8686efafe8dc`.
Every member matches `retention.json`. All 40 frozen member records match the
retained source identity
`35fed224e9e937bd6541784c392222c93626c89fd442c1eecbd179d5e3c1c1a5`.
The archived whole-plan review and 166-test PASS log belong to that freeze.

The literal source GetObject body equals the frozen envelope. Its external
pins occur in the actual NO_SOURCE project buildspec, and the StartBuild source
matches the project readback. Actual result source identities and image pins
match the retained manifest and pins. The archived offline review packet stays
labeled as such; actual provider records supply the run-specific authority.

## Artifact custody and closure

Independently decoded all six original range responses. Each of the two passes
covers bytes 0 through 589712 contiguously, with exact ContentRange and length,
canonical base64, matching ETag, AES256, modification time and build metadata.
Both reconstructed bodies equal their archived copies and have SHA256
`a81ba4b8112ad84c6ec536b06385a542effce4378161a5e4fa27ff483f78f940`,
matching HeadObject and the terminal build. The retained custody record labels
the method as two complete IfMatch range passes. Neither a range nor a prefix
is represented as a complete artifact.

Both retained checker records report twelve completed-but-incomplete cases,
68 verified inventory members and closed cleanup. The artifact expands to
7,529,401 bytes. Actual runtime and owned XFS-directory closure are present.
Four successful resource deletions and two fresh censuses retain project,
role and log-group absence, plus the same completed SUCCEEDED build. Provider
closure is distinct from the incomplete control-visibility classification.

## Factual claims

Independent parsing matched all twelve standalone CSV rows to source metrics,
exact byte-to-MiB conversions and the same-interval CPU/speed ratios. The only
standalone CSV change from the archived CSV is CRLF-to-LF normalization. All
six displayed table rows round correctly. Minimum speed is
2.61586858734812x; maximum FFmpeg and cgroup peaks are respectively 142442496
and 109096960 bytes. CPU percentage remains missing in every case; observed
throttled seconds are zero. All twelve executions completed, while all twelve
results remain INCOMPLETE for hidden higher ancestors.

The baseline image, Intel Xeon Platinum 8488C host, selected CPUs 0 and 1,
2-CPU/4-GiB child controls and synthetic generation/encoding/muxing scope agree
with retained evidence. The text preserves one-observation/shared-parent
limitations, earlier missing metrics, and the absence of current-image,
Fargate, decode/downscale, full-worker or provider-delivery qualification.
The measured production allocation table is not changed by this diff.

## Minor portability note: addressed

The archived `summary/extract_summary.py` retains its original absolute scratch
`SOURCE` path. To reproduce after extracting this checkpoint elsewhere, set
`SOURCE` to the extracted `actual/artifact-read-1.zip`; its expected SHA256
remains unchanged. The README now explicitly provides this instruction. The note is addressed
without changing the archive or source identities; no action remains.

Only this review file was written. No source/archive edits, child agents,
network/provider calls, SDK acquisition or native execution occurred.
