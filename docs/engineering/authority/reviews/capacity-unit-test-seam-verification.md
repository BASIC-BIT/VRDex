# Capacity fixture verification

2026-10-26. Source subject: `032307dd76ed56a977c7b6458fc5df8587f1f775`.
Scheduling and bridge unit fixtures now inject synthetic capacity through explicit
resolver dependencies. Production registrations still use the empty measured map.
The initial backend run exposed additional fixture callers and an invalid revoked
source assertion; their reviewed corrections are included in this subject.

| Check | Result |
| --- | --- |
| Backend suite | 2019/2019 pass, no skips |
| Scripts, including MCP's nested run | 979 pass, no failures, six documented skips |
| MCP verification | Exit 0; typecheck, 12 MCP tests, local stdio smoke and selected client-matrix checks reached |
| Temporal runtime / inference | 14/14 and 7/7 pass |
| Backend typecheck | Exit 0 |
| Actual anonymous-local Convex analysis | 572 functions; exactly one public scheduler Mutation; factory and fixture endpoints absent |

The local analysis restored both environment files exactly, left generated files
unchanged and confirmed the owned ports empty twice. Optional hosted MCP smoke
was unrun; the client matrix retains its documented pending/failed hosted states.
Five script skips require unavailable historical R93 originals; the sixth is the
opt-in playback proof. None is counted as a pass.

Complete command logs, exits, original review subjects, hash sheets, the initial
interrupted backend result and the successful rerun are retained in the adjacent
`capacity-fixtures` archives. Genuine scheduler, bridge and fixture-correction
reviews are retained separately. The retention manifest binds their exact bytes
to the three source commits.

These results establish source-test and local API behavior. Actual positive
production admission and the whole-flow migration rehearsal remain blocked on
measured allocations. Changed-image/native verification, provider rehearsal,
conditional approval, canary and capacity qualification remain OPEN.
