# Public media details and history acceptance

The website disclosure, public REST endpoint and anonymous hosted MCP tool must
return the same image details and history for the same synthetic asset IDs.
Run protocol and fixture tests before requesting the exact-candidate staging run.

## Focused local checks

```powershell
node --import tsx --test tests/web/vrdex-mcp.test.ts
node --conditions=import --import tsx --test tests/backend/hosted-mcp-profile-media.test.ts tests/backend/e2e-media.test.ts
node --import tsx --test packages/vrdex-mcp/tests/stdio.test.ts packages/vrdex-mcp/tests/api-client.test.ts
```

The hosted protocol checks actual tools/list and tools/call. The backend protocol
check connects the handler to the real public query through convex-test. The
stdio check starts the actual process against a bounded loopback REST fixture.
These checks do not prove a deployed server or a refreshed installed client.

Run `public-media-details.flow.spec.ts` against the configured local web fixture
and `public-media-details.storybook.spec.ts` against Storybook. Verify keyboard
opening, direct image anchors, collapsed attribution, actor/date fallbacks and
refusal. `PLAYWRIGHT_CAPTURE_SCREENSHOTS=false` keeps assertions active without
explicit PNG capture; enabling capture records desktop and mobile evidence.

## Joined staging proof

Use the existing `media_lifecycle=true` staging lane and
`apps/web/e2e/media-contribution.flow.spec.ts`. Its existing preflight verifies
the designated staging origin, exact candidate commit, helper authorization,
feature flags and random run ID before creating disposable accounts/media.
The controller owns deployment, any temporary intake unpause, and immediate
restoration to the prior pause state when the run becomes terminal.

The joined extension uses three synthetic records: owner-authored upload history,
trusted publication, and independent approval by distinct reviewer B of uploader
A's submission. The owner-authored row reuses an exact recorded synthetic object
already owned by this run. This proves record-backed history and download
availability, not a new owner-upload transport. Actor profiles and ownerships
carry the exact run marker and refer only to the run's disposable accounts.

For each ID, parse REST with the shared strict schema, compare anonymous and
signed-in hosted MCP results, then open the actual website disclosure. Check
uploader A separately from reviewer B and the expected event sequence. Hide the
target profile, require fresh REST 404 and MCP refusal for both caller states,
and require the website to remove its cards. Restore visibility in finally
before the original lifecycle continues.

Cleanup retains the existing object-key, reservation, lease-expiry and recovery
guards. It validates exact actor markers/ownerships before deleting actor profiles
and their ownership records. The shared synthetic object's recorded intent keys
remain the object cleanup authority. A cleanup failure preserves recovery data
and fails the run. Readback verifies media/account absence.

## Evidence limits

Record the reviewed commit, terminal hosted run, joined stages, cleanup and pause
restoration in the PR evidence. Do not prefill a successful run in this document.
Loaded connector catalog discovery is a separate check: a missing tool in the
cached catalog means client acceptance is pending. Refresh using the supported
client path; do not reinstall or rotate credentials. No production mutation or
production helper endpoint is part of this proof.
