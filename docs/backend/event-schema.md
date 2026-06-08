# Event Schema

## Status

Current recommendation and implementation note for `#34`, `#35`, `#36`, `#119`, `#132`, and `#134`.

## Event Records

Events are the primary scheduling object. They are not modeled as appearances or profile-page blocks. DJ/set-time slots are child schedule records under the canonical event.

Current event fields include:

- human-readable editable slug for `/e/<slug>` public routes
- title and sort title
- start time, optional doors-open time, and optional end time
- optional canonical event time zone
- optional linked community profile
- optional public summary and notes
- optional primary poster image URL
- source type, source label, and optional source URL
- typed media links
- publication state
- submitter identity for first-slice edit authority

Generated durable short links such as `/l/<code>` are tracked separately in `#92`. Event slugs are readable and may become owner-editable; short links should remain stable after slug edits.

## Event Times

Event `startAt`, `doorsOpenAt`, and `endAt` are stored as timestamps. The optional `timezone` field is the canonical event timezone used by operators for public schedule display and by the event editor when parsing local `datetime-local` inputs.

`doorsOpenAt` is public and optional. When provided, it must be at or before `startAt`; it does not change the event start, slot offsets, participant associations, or event-world association timestamps.

Public event pages render the canonical event timezone first, then render viewer-local equivalents from the browser timezone when available. This keeps the operator schedule authoritative while making the event understandable to viewers outside the event timezone.

Slot rows remain canonical event-time schedule rows. The first slot editor template still uses relative minute offsets from `startAt`, not `doorsOpenAt`, so set-time storage and Discord timestamp generation remain tied to the canonical event/slot timestamps.

## Community Authority

The first event editor supports submitter-owned edits so the event flow can work before full community ownership and staff roles land.

A small `communityAuthorities` table is reserved for the next authority layer:

- one community owner in v1
- familiar starter roles such as `admin` and `mod`
- capability flags such as `manage_events`

The fuller ownership and staff-role foundation is tracked in `#93`.

## Event Participants

`eventParticipants` links person profiles to events. This keeps profile-facing event views derived from a canonical event record rather than making `appearance` the core object.

Participant links support:

- claimed and unclaimed published person profiles
- freeform role labels such as `Performer`, `Staff`, or a community-specific label
- source type, source label, and optional source URL
- confirmation state
- optional notes

Public person profile pages should only render published events through confirmed participant links to public person profiles.

Approval, dispute handling, notifications, recurring events, RSVP/interested state, and friend-aware discovery are follow-on work tracked outside this first `#35` association slice.

## Event Slots

`eventSlots` stores ordered set-time records under a canonical event. Slots are the detailed schedule layer for multi-DJ or multi-performer events; they do not replace `eventParticipants`.

Slot records support:

- event id and denormalized event start timestamp for query/sort stability
- zero-based position
- start time and optional end time
- optional linked person profile
- public display label for unlinked or tentative performers
- freeform style or role label such as `House`, `Trance`, `VJ`, or `Host`
- source type, source label, optional source URL, confidence, and review state
- optional notes

Confirmed slot performers are also deduped into `eventParticipants` on event save so person profile upcoming-event views continue to work from broad profile-event associations. The combined explicit participants plus linked slot performers must stay within the event participant cap. The slot record remains the ordered set-time detail; the participant record remains the profile-event relationship.

Slot start times must be at or after the event start. When an event end time is provided, slot end times must stay within that event window. Public projection keeps the slot row when a linked performer profile is no longer publicly readable, but drops the performer link and falls back to the public slot display label.

Canonical slot times are stored as timestamps. Discord timestamp tokens such as `<t:1781474400:F>` are generated from saved event/slot timestamps for display or export; they are not canonical storage.

The first slot editor uses relative minute offsets from the event start for operator-friendly sequential scheduling. Backend storage still receives absolute timestamps after the operator confirms the event start and a valid IANA timezone.

## Event Media Links

Event media links are intentionally more flexible than a rigid platform dropdown.

The first typed set is:

- `event_page`
- `watch`
- `stream`
- `vrcdn`
- `discord`
- `ticket`
- `other`

Each media link has a label, URL, and presentation hint. General links must use HTTPS. VRCDN media links may be supplied as VRCDN page URLs, HLS URLs, Quest-compatible `.live.ts` URLs, directly playable MP4/WebM/Ogg URLs, or PC-oriented technical protocols such as `rtspt://`; the backend stores stream variants as the canonical `https://vrcdn.live/{streamId}` page URL once it can derive the stream ID, while direct MP4/WebM/Ogg files stay as direct URLs for native playback.

The event editor treats VRCDN links as a provider-specific input surface: once it detects a stream ID, it shows copy-ready Quest MPEG-TS and PC RTSPT player URLs plus the browser preview page.

- `open` for normal outbound links
- `copy` for operational links such as VRCDN links that may need to be pasted into a world or tool

Future smart labeling, remembered vocabularies, URL-derived icons, and platform-specific UX are tracked in `#90`.

## Public Watch Surface

Public event pages promote one primary watch source above the normal link list only during the event's scheduled watch window. Outside that window, watch links stay in the normal link list.

Selection order is deterministic:

1. first `watch` link in saved media-link order
2. first `stream` link in saved media-link order
3. first `vrcdn` link in saved media-link order

The promoted link remains visible in the normal links section so viewers can still scan the complete event link set.

Embeds are limited to explicitly supported providers:

- YouTube watch, live, shorts, and embed URLs render through a `youtube-nocookie.com` iframe.
- Twitch channel, video, collection, and clip URLs render through Twitch's player or clips iframe with the current browser hostname passed as the required `parent` parameter.
- VRCDN page, HLS, Quest `.live.ts`, PC `rtspt://`, and direct MP4/WebM/Ogg URLs are normalized by stream ID. Direct MP4/WebM/Ogg URLs render as native video; the other VRCDN variants derive an HLS URL and render through `hls.js` with native HLS fallback where available.

Unsupported watch URLs fall back to a prominent outbound watch card during the scheduled watch window. Source liveness checks, operator status, and restream switching remain part of the larger media-control model tracked in `#124`; public UI should not expose those implementation boundaries as explanatory copy.

## Event Media Control Plane

The restreaming/media-control foundation uses event-scoped records rather than overloading the existing `events.mediaLinks` array.

Current control-plane tables include:

- `eventMediaPrograms` for the event-level media program, public watch links, direct fallback links, and active source/output/session pointers.
- `eventMediaSources` for performer streams, VJ streams, event cameras, VRCDN links, Twitch watch links, HLS/RTMP sources, hold visuals, and audio loops.
- `eventMediaScenes` for source scenes, hold slates, intros, outros, offline cards, and countdowns.
- `eventMediaOutputs` for operator-owned VRCDN, external RTMP, AWS HLS, IVS, or manual output targets.
- `eventMediaCommands` for queued operator, Discord, worker, or system commands such as start, stop, hold, next, source switch, fallback, and watch-link publication.
- `eventMediaSessions` for concrete worker runs, leases, current source/scene, and health heartbeats.
- `eventMediaAuditEvents` for immutable operator and automation history tied back to events, programs, sessions, commands, sources, and outputs.

Public projection must stay narrow: public surfaces can show safe status, current source/output labels, public watch links, and direct fallback links. They must not expose worker identifiers, command queue internals, secret references, private setup notes, ingest URLs, stream keys, or provider-specific failure mechanics.

The first account model is `operator_owned`. Output credentials are represented only by scoped secret references in the control plane; secret values belong in encrypted provider secret storage, not in event records, docs, logs, or audit summaries.

### Operator-Owned VRCDN Outputs

Current recommendation: VRCDN output setup starts with operator-owned accounts only. VRDex stores setup metadata and a scoped secret reference, while the actual stream key or credential value stays in encrypted operator secret storage.

`eventMediaOutputs` can carry public-safe setup fields for a VRCDN target:

- `credential.storage`, currently `operator_secret_store`
- `credential.secretRef`, a scoped reference name only
- `vrcdnSetup.ingestRegion` for the operator-selected VRCDN ingest region
- `vrcdnSetup.targetVideoBitrateKbps`
- `vrcdnSetup.keyframeIntervalSeconds`
- `vrcdnSetup.audioSampleRateHz`
- `vrcdnSetup.targetAudioBitrateKbps`
- `compliance.sourceConsent`
- `compliance.destinationAuthority`
- `compliance.providerRules`
- `compliance.rightsClearedMedia`

The setup helper treats the output as `ready` only when a credential reference exists and all required compliance gates are accepted. Missing gates remain `pending`; explicitly rejected gates are `blocked`. A blocked or incomplete output stays a draft and should not be used by a worker.

Secret references must not be URLs, ingest URLs, passwords, tokens, stream keys, or provider credential values. Those values must stay in the configured secret store and be read only by the runtime that needs to push the stream.

Open provider/legal gates remain outside the schema:

- provider terms and automation approval for the chosen destination
- source-owner consent for each live input VRDex processes
- destination account authority for the operator-owned output
- rights clearance for hold slates, music, visuals, logos, intro/outro media, VJ layers, and camera feeds
- takedown, abuse-response, and broadcaster-of-record review before any hosted managed output model ships

## Event-World Links

World linkage uses explicit `eventWorlds` records rather than storing world context only as event text.

Public world and Home activity surfaces should continue to use only:

- published events
- confirmed event-world associations
- published world records
- HTTPS-filtered public URLs

Automatic world inference, live VRChat presence, scraped popularity, and private attendance data remain non-goals for this slice.
