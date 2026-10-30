# Final relay review fix evidence

Local evidence for the single consolidated I1/I2/I3/M1 fix wave. Rollout remains
disabled. These results do not authorize deployment or satisfy hosted/phone gates.

- `cors-plan.json`: actual production Terraform module's mock-provider plan,
  eight plan-only cases passing, signed distribution and CORS/cache policy output.
  Provider-generated policy/key IDs remain unknown; the verifier checks the
  configured policy reference and the emitted unknown attachment separately.
- `runtime-plan.json`: actual emitted runtime configuration accepted by the
  production parser, with only named provider unknowns substituted.
- `segment-cors.json`: real Chromium cross-origin TLS GET and HEAD read 564
  fixture bytes using the emitted exact application/preview allowlist. Unsigned
  requests receive 403; an unreviewed origin cannot read the response. The page is
  routed locally and the segment endpoint is a real loopback TLS server. Chromium
  grants local-network access for this fixture; normal CORS remains enforced.
  These TS-shaped bytes test browser delivery, not media decoding or AWS behavior.
- `gateway-artifact.json`: actual packaged ZIP extracted and imported. Six distinct
  sources serve signed 200 manifests sequentially in one warm handler at source
  cap one. Uses local AWS HTTP protocol fixtures and a control RPC double, with a
  controlled clock advanced past idle retirement. It does not contact AWS.

The current package hashes in `../media-relay-task12/worker-artifact.json` now
include the final gateway source and ZIP. The worker bundle is byte-identical to
Task 12, so its existing actual-image smoke remains applicable; no worker rebuild
or repeat image/long-demand/artwork test was needed.

Reproduce from the repository root after activating the prepared tools:

```bash
terraform -chdir=infra/terraform/media-relay test -json -verbose > /tmp/relay-plan.jsonl
node --import tsx scripts/verify-media-relay-plan.ts /tmp/relay-plan.jsonl
node --import tsx scripts/verify-media-relay-cors.ts /tmp/relay-plan.jsonl /tmp/relay-cors.json
node scripts/package-media-relay.mjs /tmp/relay-package
node scripts/verify-media-relay-gateway-artifact.mjs /tmp/relay-package/gateway.zip /tmp/relay-gateway.json
```

Hosted signed CloudFront cross-origin playback, physical iPhone/Android acceptance,
hosted capacity/recovery margin, disk/FFmpeg buffer containment and the hard
traffic-budget requirement/design decision remain open. PAYG owner acceptance
cannot silently waive the approved hard ceiling. Selected CI/browser evidence
also remains outstanding; this focused Chromium check does not establish Firefox.
