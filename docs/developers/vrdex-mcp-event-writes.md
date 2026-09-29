# VRDex MCP Event Writes

## Contribution intake

Hosted and local MCP register the same ten intake tools, using the shared REST
schemas and actor-bound commands:

- `vrdex_event_intake_draft_save`
- `vrdex_event_intake_draft_get`
- `vrdex_event_intake_extract`
- `vrdex_event_intake_publish`
- `vrdex_event_intake_poster_upload_begin`
- `vrdex_event_intake_poster_upload_complete`
- `vrdex_event_intake_artwork_select`
- `vrdex_event_intake_event_get`
- `vrdex_event_intake_event_update`
- `vrdex_event_intake_event_retract`

Hosted writes need user-delegated `mcp:write events:contribute`; draft and
contribution reads need `mcp:read events:contribute`. Local tools call the API
using a user-owned token with `events:contribute`. Neither path requires
verified email. The owner tools below still require `events:write` and
community authority.

Website and MCP drafts interoperate. Save the returned `draftId` and `version`.
Publication returns `eventId`, `eventPath`, and `receiptId`. After a lost response,
read the draft and replay publication with the same version and idempotency key.
Never make a new draft or key just because the response was lost. Poster upload
and extraction do not select public artwork; call `artwork_select` deliberately.
Call `event_get` with the published slug to obtain `updatedAt` before
`event_update`; pass that revision as `expectedUpdatedAt`.

`draft_save` accepts an ordered `posterSourceIds` list of up to five unique
private upload IDs. Save checks that each list entry belongs to the actor and
draft, and permits pending uploads. The older singular `posterSourceId` remains
accepted as an opaque draft reference. `extract` accepts ordered
`posterAssetIds` or the legacy singular `posterAssetId`; each extraction source
must be ready and valid for the same actor and draft before quota is reserved.
If both forms appear, the singular ID must match the first list entry. A plural
request currently returns the manual fallback after source validation until
the multimodal extractor update. Candidate evidence remains private, capped at
40 entries, and can identify a zero-based `posterIndex`; candidate event and
lineup times can carry nullable ISO `startDate` and `endDate`.

The local-only `vrdex_event_intake_poster_upload_bytes` helper accepts `draftId`,
`contentType`, and base64 content explicitly supplied from a chosen local file.
It never reads filesystem paths or fetches source URLs. Set
`VRDEX_EVENT_POSTER_UPLOAD_ORIGIN` to the exact HTTPS S3 upload origin used by
your deployment, with no trailing slash. The helper rejects another origin,
credentials, and redirects; it sends no API bearer token to storage. PNG, JPEG,
and WebP signatures and a 12 MiB limit are checked locally. Completion fully
decodes the image and checks its declared MIME, length, and digest server-side.
Clients unable to send bounded image content can use the begin/complete tools
with their own explicitly authorized file transfer.

These are local implementation and fixture checks. Hosted storage, provider
accuracy, and production behavior require separate deployment evidence.

## Schedule and correction readback

A date-only public event has `scheduleKind: "date_only"` and `eventDate`, with no
`startAt`. Do not synthesize midnight or activate watch playback. Calendar export
uses a date value with Time TBA; timed events retain exact instants. Lineup readback
preserves ordered timed, untimed and unmatched entries.

Staff takeover closes contributor updates/retraction even with a fresh revision.
A contributor can retry a successful retraction; the replay returns `changed: false`.
A contributor can submit a correction suggestion through the event report flow;
it does not edit the canonical event. Removal excludes the event from public
lookup, search and feeds. Scope/version/actor parity is covered locally; hosted
OAuth and connected browser proof remain outstanding in the
[checkpoint](../testing/event-intake-checkpoint.md).

## Status

Implementation checkpoint for
[#184](https://github.com/BASIC-BIT/VRDex/issues/184).

The local/private `@basicbit/vrdex-mcp` stdio server can expose authenticated
event-create and event-update tools over the existing `/api/v0` routes. It also
exposes `vrdex_profile_update` and `vrdex_profile_submit` on the same terms;
those need `profile:write` or `profile:contribute` rather than `events:write`,
and are described in
[`hosted-mcp-oauth-writes.md`](./hosted-mcp-oauth-writes.md), which covers both
the hosted and local write surfaces. The hosted `/mcp` implementation stays
anonymous-capable for reads and registers every write tool behind OAuth.

The real Faceless production proof is still operator gated. Do not create a
fake production event or execute a real write until the operator has selected
the event data and approved that exact tool call.

## Tools

### `vrdex_event_create`

Creates and publishes an event attached to a community owned by the
authenticated user. Its input is the shared `ApiEventCreateRequest` contract.

### `vrdex_event_update`

Updates an owned community event. Its input contains:

- `slug`: the event's current public slug
- `update`: the shared `ApiEventUpdateRequest` contract

Omitted update fields are preserved. Documented nullable fields use `null` to
clear, collection fields use an empty array to clear, and lineup replacements
must supply `participantLinks` and `slotLinks` together.

Both tools:

- are registered only when local stdio has a non-empty bearer credential. The
  profile tools register on the same condition, so a token carrying only
  `events:write` still lists them and receives a `403` from the API if it calls
  one. Scope is enforced at the route, not by hiding the tool
- call the public API rather than a private Convex mutation path
- require an API-resource credential with `events:write`, user authority, and
  ownership of the target community
- keep the six public read tools anonymous even when the local server has a
  write credential configured
- are annotated as mutating and open-world so an MCP host can require
  explicit user approval
- read the saved public event back anonymously after an accepted write, so the
  write credential does not also need `public:read`
- return the write identifiers, canonical URL, and normalized public event

Tool annotations are advisory protocol metadata. Operators must use an MCP host
that presents an approval step for mutating tools and inspect the exact
arguments before accepting the call.

## Local Configuration

Create a personal API token at `/developers/tokens` with `events:write`. Add
`community:read` when following the full operator runbook, which verifies the
target community through `/api/v0/me/communities`. Configure the local stdio
server without placing the raw token in repository files:

```json
{
  "mcpServers": {
    "vrdex-private": {
      "command": "pnpm",
      "args": [
        "--silent",
        "--dir",
        "<path-to-vrdex-checkout>",
        "exec",
        "tsx",
        "packages/vrdex-mcp/src/stdio.ts"
      ],
      "env": {
        "VRDEX_API_BASE_URL": "https://vrdex.net",
        "VRDEX_API_TOKEN": "<personal-api-token>"
      }
    }
  }
}
```

An API-resource OAuth access token can be supplied through
`VRDEX_OAUTH_ACCESS_TOKEN` or `VRDEX_OAUTH_TOKEN_FILE`. Hosted `/mcp` tokens are
bound to the MCP resource and cannot be reused for these API-backed local
tools.

If no bearer credential is configured, local stdio lists only the six public
read tools. A present but revoked, expired, under-scoped, wrong-resource, or
wrong-owner credential still lists the tools, but the API rejects every write
before mutation.

## Write And Readback Safety

An accepted mutation is followed by `GET /api/v0/events/:slug`. If that
readback fails, the tool reports that the write already succeeded and tells the
caller not to retry automatically. Inspect the event by its returned slug
before taking another action; blind retries can create a duplicate event or
repeat an audit entry.

Thrown mutation requests and HTTP 5xx mutation responses are also reported as
indeterminate outcomes because the server may have committed before the
response failed. Inspect existing state before retrying either operation.

API problem responses remain structured tool errors. They may include safe
status, title, detail, and retry timing, but never the bearer credential.

## Operator Runbook

Before a real community event write:

1. Use `GET /api/v0/me` to confirm the credential is user-authorized and has
   `events:write` plus `community:read`.
2. Use `GET /api/v0/me/communities` to confirm the target community is claimed
   and owned by that user.
3. Prepare the complete create payload or the minimal update payload.
4. Show the exact tool name and arguments to the operator.
5. Execute only after explicit action-time approval.
6. Confirm the tool's normalized readback and canonical public URL.
7. Open the event in the normal signed-in web UI and verify edit and media
   authority.
8. Record only sanitized evidence. Never paste tokens into issues, logs, docs,
   or screenshots.

For the first Faceless proof, use a real operator-selected event. The proof must
cover MCP write, API/public readback, the public event page, and normal web
edit/media authority. It must not enable VRChat telemetry collection or weaken
the separate provider-approval and non-empty-instance gates.

## Rotation And Revocation

- Revoke a personal token immediately from `/developers/tokens` when it is no
  longer needed or may have been exposed.
- Create a replacement token before updating local MCP configuration.
- Restart the MCP client after rotating the configured credential.
- OAuth access tokens remain short-lived and resource-bound; rotate them
  through the normal authorization and refresh-token flow.

## Performer sequence authoring

Existing event create/update tools accept `watchMode: "event_stream" | "performer_sequence"` and per-slot `selectedStreamId`. Use a normalized VRCDN ID from that performer's discovery-visible links. `null` clears a supplied row's explicit choice. Omitting schedule collections preserves saved choices; replacing schedule data still requires both `participantLinks` and `slotLinks`. These fields add no permission or tool, and owner authority plus `events:write` remain required. MCP create continues to publish atomically.

A removed explicit stream stays unavailable rather than selecting another source. The event readback contains effective `watchMode`, typed participant/performer `outboundLinks`, and each slot's `playbackKey` plus optional canonical `stream`. Event roster visibility excludes unlisted and private links. Direct video files are roster links but are not live stream choices.
