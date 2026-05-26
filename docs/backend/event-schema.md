# Event Schema

## Status

Current recommendation and implementation note for `#34`, `#35`, and `#36`.

## Event Records

Events are the primary scheduling object. They are not modeled as appearances, slots, or profile-page blocks.

Current event fields include:

- editable readable slug for `/e/<slug>` public routes
- title and sort title
- start time and optional end time
- optional time zone
- optional linked community profile
- optional public summary and notes
- optional primary poster image URL
- source type, source label, and optional source URL
- typed media links
- publication state
- submitter identity for first-slice edit authority

Generated durable short links such as `/l/<code>` are tracked separately in `#92`. Event slugs are readable and may become owner-editable; short links should remain stable after slug edits.

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

Each media link has a label, HTTPS URL, and presentation hint:

- `open` for normal outbound links
- `copy` for operational links such as VRCDN links that may need to be pasted into a world or tool

Future smart labeling, remembered vocabularies, URL-derived icons, and platform-specific UX are tracked in `#90`.

## Event-World Links

World linkage uses explicit `eventWorlds` records rather than storing world context only as event text.

Public world and Home activity surfaces should continue to use only:

- published events
- confirmed event-world associations
- published world records
- HTTPS-filtered public URLs

Automatic world inference, live VRChat presence, scraped popularity, and private attendance data remain non-goals for this slice.
