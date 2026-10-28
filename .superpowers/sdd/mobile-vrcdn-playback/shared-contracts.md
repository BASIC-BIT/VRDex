The following interfaces are named contracts for neighboring tasks. Define their exact schemas once in Task 1; derive TypeScript types from them. Convex database field validators are storage representations, not an independent external protocol.

```text
PlaybackMode = video | audio
PublicContext = profile(profileId, linkId) | event(eventId, selectedSourceId)
StreamKey = canonical provider/streamId/packagingVersion identity
SourceDescriptor = { streamKey, streamId, inputFormat: vrcdn_fmp4, packagingVersion: 1 }
DjMetadata = { displayName, artworkAssetId: string|null, artworkRevision: string|null }
PlaybackGrant = { id, streamKey, context, contextRevision, issuedAt, expiresAt, renditions: [video,audio] }
Admission = preparing(retryAfterMs) | ready(grant, videoPlaylist, audioPlaylist, metadata)
          | unavailable(reason) | capacityLimited(retryAfterMs)
OwnershipLease = { streamKey, workerId, epoch, serverNow, expiresAt, renewAfterMs }
RenditionSnapshot = { streamKey, epoch, rendition, targetDurationSeconds,
                     sequence, discontinuitySequence, generatedAt, segments }
Segment = { sequence, objectKey, durationSeconds, programDateTime, discontinuity }
WorkerObservation = { workerId, workerEpoch, observedAt, allocation, activeJobs, resources,
                      jobs: [{streamKey, sourceEpoch, state, progressAt}] }
```

Defaults copied from the approved design: idle grace 180,000 ms; source recovery budget 30,000 ms; grant lifetime 43,200,000 ms; segment URL validity at least 300,000 ms; freshness `max(10,000 ms, 3 * actualTargetDurationMs)`; target segment duration approximately two seconds. Planning choices: lease 30,000 ms, renew every 10,000 ms, local watchdog every 250 ms, rolling window eight segments. Keep these in one shared policy module and test boundaries.

Task 6 external service schema is `GatewayAuthorizationSchema` in
`packages/media-relay/src/contracts.ts`: denied; unavailable with bounded reason;
or active with grant, queued/starting/ready/recovering state, nullable epoch,
leaseExpiresAt and authoritative PublishedSnapshot. Public service query
`mediaRelayWorker:readGateway({credential,grantId,rendition})` uses a separate
gateway token. Exact callable adapters, demand probe/update/read contracts and
Lambda v2 boundary are in `docs/engineering/media-relay-gateway.md`.
