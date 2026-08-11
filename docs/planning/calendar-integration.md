# Calendar Integration Direction

## Status

Current recommendation for [#41](https://github.com/BASIC-BIT/VRDex/issues/41). Implementation follow-up [#138](https://github.com/BASIC-BIT/VRDex/issues/138) tracks practical calendar import/export workflows.

Calendar integration is a valuable follow-on workflow feature for events, but it should not be forced into the first profile/discovery slice.

## Product Value

VRDex event data becomes more useful when people can carry it into their calendar workflow instead of repeatedly checking the site.

Likely user outcomes:

- follow a person, community, or event series and see upcoming events on a calendar
- export a single event into a personal calendar
- subscribe to a calendar feed for a profile/community/event category
- import selected Google Calendar events into reviewable VRDex event candidates
- keep updates in sync when event time, title, location, or cancellation state changes

## Modes To Preserve

### Static Export

Use `.ics` export for simple single-event or filtered event-feed workflows.

Benefits:

- simple to implement
- works across calendar clients
- useful before account-level OAuth exists

Tradeoff:

- users may not receive updates reliably unless they subscribe to a feed instead of importing once

### Outbound Real Sync

Use Google Calendar API sync when VRDex needs durable update/delete behavior for user-selected events.

Benefits:

- better update semantics
- clearer user workflow for followed profiles or communities
- can support reminders and long-lived subscriptions later

Tradeoff:

- requires OAuth consent, token storage, disconnect behavior, sync error handling, quota management, and self-host operator setup

### Inbound Google Calendar Import

Use Google Calendar import when organizers already maintain selected public or operator-owned calendars and VRDex needs those events as reviewed event candidates.

Benefits:

- avoids retyping existing event plans
- can preserve external event IDs, update timestamps, and source provenance
- fits the broader reviewed-import model instead of treating imported data as owner-confirmed truth

Tradeoff:

- requires careful privacy boundaries, event-field mapping, recurrence handling, cancellation/update behavior, and review workflows before publication

### Service-Account Shared Calendar

Candidate early path: a VRDex-managed or operator-managed shared public calendar for selected events.

Benefits:

- simpler than per-user writeback
- useful for public community calendars or launch demos
- avoids storing every user's Google tokens early

Tradeoff:

- less personalized
- still needs ownership, moderation, and update rules for what gets published

## Merged Vs Split Calendars

Preserve both product choices for later validation:

- merged calendar: one feed containing all events a user follows
- split calendars: separate feeds by person, community, event category, or operator workspace

Default recommendation: start with merged feeds for simplicity, then add split calendars once users show that they need separation.

## Outbound Data Rules

Calendar output should include only public event data that is safe to expose:

- event title
- start/end time and timezone
- public summary
- canonical VRDex URL
- public world/community/profile references when allowed by visibility and opt-out rules
- cancellation/update state when modeled

Do not include private notes, moderation fields, private contact paths, unreviewed scraped data, or hidden/suppressed entities.

## Implemented Export Slice

Locked decision: the first practical calendar implementation is outbound-only single-event `.ics` export for public event pages.

Published events can be exported from `/<slug>/calendar.ics`. The route reads the same public event projection used by `/<slug>`, returns `404` when the event is missing or not public, and emits UTC `VEVENT` timestamps with summary, canonical VRDex URL, and public location text derived from visible world or host data.

Current recommendation: keep the public export surface static and public-data-only. The shared ICS serializer now supports both a single safe event export and a selected public event feed, but product UI for feed subscriptions should wait until follow, favorites, or community calendar selection exists.

Do not add Google OAuth, account calendars, token storage, or personalized subscription UI until the reviewed-import and follow/favorites models are ready.

## Implemented Import Foundation

Locked decision: Google Calendar import begins as reviewed staging only, not a public event publisher.

The first backend foundation adds Convex staging tables for:

- `eventImportBatches`
- `eventImportCandidates`
- `eventImportCandidateFields`

The Google Calendar normalizer maps selected public/operator-owned calendar event fields into private review candidates. It preserves calendar/event IDs, batch or sync job identifiers, source update timestamps, source URLs, title, description, available start/end time, timezone, location, public HTTPS links, recurrence hints, and cancellation state.

Imported candidates default to `draft_private` and `unreviewed`. The helper can write staging documents, including cancellation tombstones without event start times, and evaluate publication blockers, but it does not create canonical `events` rows, run background sync jobs, resolve conflicts, or expose an import UI.

## Inbound Import Rules

Google Calendar import should create reviewable event candidates, not silently published canonical events.

Imported candidates should preserve:

- source calendar and event IDs
- import batch or sync job
- event updated timestamp
- mapped title, description, start/end time, timezone, location, and links
- recurrence and cancellation hints when present
- field-level source/provenance and review state

Do not import attendees, reminders, private notes, hidden calendar metadata, or arbitrary personal calendars by default.

Imported candidate publication requires a later explicit review flow. Before publication, the batch must be approved, the candidate must be accepted and queued for review-pending publication, public fields must be reviewed, cancelled events must stay blocked, and private source fields must not be promoted as public event facts.

## Self-Hosting Notes

Self-hosted operators that enable Google Calendar sync or import will need their own Google Cloud OAuth or service-account configuration. Do not hard-code BASIC BIT calendar project IDs or secrets into committed defaults.

## Non-Goals For First Slice

- building calendar sync now
- building Google Calendar OAuth, token storage, or background import jobs now
- final multi-provider calendar abstraction
- full event-subscription preference UI
- per-user Google OAuth token storage before the account and event-follow models are ready
- importing private calendar data before reviewed import workflows and provenance rules are ready
- publishing imported candidates directly into canonical events
