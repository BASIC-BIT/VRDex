# Main integration verification evidence

This archive retains the reviewed integration of stream qualification authority and capacity fixtures with main. Reviewed commit `f0c1005f9a9220aa8a5150c8dc6bc16a9a25693f` and CI merge `8bfb97a967e4d4c254292fc6ea9362c383398ab5` share tree `965d03ab60989340290804dee8e4aaa981017b2c`.

`retention.json` binds the complete archive and all 70 original members. Root independently verified every member's complete length and SHA256. `candidate-original-refs.json` preserves the packaging phase's original scratch references and local-candidate status as historical metadata. The archive is 1,690,862 bytes and contains 7,650,110 uncompressed bytes.

The archive includes the integration review and both parent diffs, caller/protected-file comparisons, full and focused test logs, postcommit MCP/documentation checks, anonymous-local API analysis, and the actual CI run metadata and complete migration artifact. The API receipt has no explicit source SHA; its recorded API and cleanup results remain separate from the review and CI source bindings. Environment files and backups are excluded. Scoped content-screening results are retained in `screening.json`; complete CI raw logs remain outside this focused archive.

Backend verification passed 2022 tests; the script suite passed 986 with six explicit skips. CI run 40417706641 succeeded on the same tree. The migration artifact establishes only `migration-admission-blocked`, including expected rejection without session/start writes and fixture/process cleanup. It does not establish successful production admission, whole-flow migration, measured capacity, reviewed native qualification, browser/visual execution or production deployment. Earlier review reports retain their historical phase-specific gaps.
