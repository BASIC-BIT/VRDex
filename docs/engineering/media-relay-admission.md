# Shared VRCDN playback admission

`convex/mediaRelayPlayback.ts` admits explicit public Play requests. Public profile
and event page queries remain read-only and do not create sources or grants.
The relay uses one source row per case-preserving `StreamKey`, independently of
context grants. Source creation and capacity checks happen in the same Convex
mutation, so concurrent admissions reuse one queued source.

## Public caller contract

`openPlayback({context, streamId, preferredMode})` returns the shared
`packages/media-relay` Admission contract. A preparing result includes the opaque
`grantId` to pass to `getPlayback({grantId})`. `releasePlayback({grantId})` is
idempotent and releases only that grant. A grant permits both video and audio
renditions for exactly 43,200,000 ms. Mode preference remains client state; it
must persist across DJ changes until the listener explicitly changes it.

Existing outbound/media links do not have stored row IDs. Use these stable
context identifiers, which the backend checks against the actual public source:

| Context | Identifier |
| --- | --- |
| Profile | `profileId` is the profile document ID; `linkId` is the canonical, case-preserving VRCDN stream ID parsed from a link in its public profile-page projection. Equivalent URL spellings identify the same stream. |
| Event with `event_stream` mode | `eventId` is the event document ID; `selectedSourceId` is the canonical VRCDN stream ID parsed from an authorized public `watch`, `stream`, or `vrcdn` media link. |
| Event with `performer_sequence` mode | `selectedSourceId` is the projected slot's existing `playbackKey`. The selected slot must resolve the requested stream through its current public performer and stream choices. |

A raw stream ID never establishes authority. Profile publication and field
visibility use the existing public profile helpers; event publication, community,
slot, and performer checks use the existing public event projection. Direct video
files do not become live relay inputs. Invalid source identities return
`unavailable` with reason `unsupported`.

New event admission must fall inside the existing doors/start-to-end watch
window. An existing unexpired grant can continue after that window while its
context remains authorized. Its server-issued admission time is continuation
proof: the server cannot determine whether native playback became audible.
Cancellation, disabled watch surfaces, date-only events, hidden public context,
or removal/change of the selected source deny revalidation. A shared source's
existence never authorizes a new out-of-window start.

The context revision fingerprints only source identity and publication policy,
including the profile link visibility or event watch mode/slot performer.
Display names, descriptions, artwork, labels, and calendar continuation are not
revision inputs. Every resolution also rechecks current authorization. Removing a source denies its
grant immediately; restoring exactly the same public source and policy may
revalidate a still-unexpired grant. Explicit release remains latched across any
restore. The revision is not a permanent revocation tombstone. Live
metadata reads public selected artwork IDs/revisions without changing original
assets. Missing asset-backed artwork is represented by null handles.

## Server configuration

These are Convex backend environment variables owned by the VRDex operator.
Admission is disabled unless explicitly enabled with all three positive integer
limits. Missing, zero, fractional, negative, or above-bound values fail closed.
Task 7 release controls must align with these limits before any live enablement.
No configuration in this implementation enables production admission.

| Variable | Default | Accepted values |
| --- | --- | --- |
| `MEDIA_RELAY_ENABLED` | disabled | Exactly `true` enables admission subject to all limits. |
| `MEDIA_RELAY_MAX_SOURCES` | 0 | 1–1,000 concurrent queued/starting/ready/recovering/draining source rows. |
| `MEDIA_RELAY_MAX_GRANTS` | 0 | 1–10,000 unreleased, unexpired grants globally. |
| `MEDIA_RELAY_ADMISSIONS_PER_MINUTE` | 0 | 1–10,000 successful admissions in a rolling 60,000 ms global window. |
| `MEDIA_RELAY_PLAYBACK_ORIGIN` | unset | Operator-controlled HTTPS base URL, without credentials, query, or fragment. |

Limits use bounded indexed reads and Convex transaction conflict detection,
matching existing backend quota conventions. Release returns grant capacity but
retains admission history for the rolling rate limit. Source idle lifecycle and
grant cleanup belong to the following relay lifecycle work. Public page reads
and grant polling never renew source activity; native playlist requests sustain
an admitted source in the delivery layer.

A source in `ready` state returns capability URLs under
`<origin>/p/<grantId>/video/index.m3u8` and `/p/<grantId>/audio/index.m3u8`. Missing delivery origin
keeps admission preparing; delivery implementation must use this same route
contract and call internal `resolveGrant({grantId, now})`. `now` is trusted server
time, never a caller-controlled expiry override. An off switch denies existing
grants as well as new admissions. These variables contain no credentials;
recreation means restoring reviewed operator configuration, and no key rotation
is required. Grant handles are server-generated cryptographic UUIDs and must be
treated as bearer capabilities rather than logged or exposed in page data.
