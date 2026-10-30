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

Use Google Calendar import when organizers already maintain a Google calendar and VRDex needs those events as intake candidates.

Benefits:

- avoids retyping existing event plans
- preserves external event IDs and update timestamps on the sync link
- uses the same intake candidate path as other connector imports instead of treating imported data as owner-confirmed truth

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

Published community events can be exported from
`/<community>/events/<event-code>/calendar.ics`. The route reads the same public
event projection used by the nested event page, verifies that the event belongs
to the routed community, returns `404` when the event is missing or not public,
and emits UTC `VEVENT` timestamps with summary, canonical VRDex URL, and public
location text derived from visible world or host data.

Current recommendation: keep the public export surface static and public-data-only. The shared ICS serializer now supports both a single safe event export and a selected public event feed, but product UI for feed subscriptions should wait until follow, favorites, or community calendar selection exists.

## Google Calendar Connector

Google Calendar sync is the `google_calendar` connector kind; see [Connectors](../backend/event-schema.md#connectors) for the tables and runner. A community connects a calendar through Google OAuth and picks import, export, or both.

Inbound import rules:

- Imports enter as intake candidates, not silently published canonical events.
- Only title, start, end, summary, and location carry. Poster, world, and lineup never move.
- Past items and recurring instances more than 60 days ahead are not imported.
- A Google cancellation flags the sync link `external_deleted`; it never cancels the VRDex event.
- Attendees, reminders, private notes, and hidden calendar metadata are never imported.

## Self-Hosting Notes

Self-hosted operators that enable Google Calendar sync or import will need their own Google Cloud OAuth client; see [Convex Environments](../deployment/convex-environments.md#google-calendar-connector). Do not hard-code BASIC BIT calendar project IDs or secrets into committed defaults.

## Non-Goals For First Slice

- final multi-provider calendar abstraction
- full event-subscription preference UI
- importing private calendar data before reviewed import workflows and provenance rules are ready
- publishing imported candidates directly into canonical events
