# SDK response guard checkpoint

This retains the reviewed correction to the private retained-image transfer harness. The SDK previously buffered control responses before its raw-body limiter was installed. The correction defers that preload, installs the limiter before model-based parsing, and preserves source-stream ownership and primary failures during cleanup.

`reviewed-source.zip` is 866,942 bytes with 193 members. SHA256: `f603eb520c2ad502e972228d9ebf74b4e0aa4bb4c238745f529fd7d25c8a749d`. Its `subjects.json` inventories complete source, generated fixtures, retained test output, initial and corrected reviews, and exact preservation records.

The initial full private suite passed 82 tests. Independent review found an upload-consumer cleanup gap; three direct runner regressions reproduced it. After correction, all 23 tests in the covering response-guard file passed. No full 85-test run is claimed. Final scoped SPEC and QUALITY review passed, SHA256 `44a34a7a1de5f4e5576fd4258ccb3c7e86093897b54b530693aec0993fa64626`.

The current `transport.py` is 49,188 bytes, SHA256 `9beb963400c72a4f6e8b91c1573bfba609c3acb1aba215428c190fc1234622e5`. The initial freeze and its original report are under `initial/`; corrected artifacts are under `current/`. Each freeze's relative report reference resolves to the report for that phase. Original manifests and their file bytes are preserved.

These are generated-fixture and source-review results. Real SDK preflight still rejects `unsupported_sdk_path`. No provider trial, image transfer, native verification, capacity measurement or production admission follows from this checkpoint. Header/framing limits, the selected SDK profile, observer and uploader accounting, and actual runtime fit remain separate work.

The repository source implementation remains `f0c1005f9a9220aa8a5150c8dc6bc16a9a25693f`; this checkpoint changes documentation evidence only. The separate managed SDK source captures remain private and are not included here.
