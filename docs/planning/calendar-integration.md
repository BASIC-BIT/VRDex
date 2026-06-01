# Calendar Integration Direction

## Status

Current recommendation for `#41`.

Calendar integration is a valuable follow-on workflow feature for events, but it should not be forced into the first profile/discovery slice.

## Product Value

VRDex event data becomes more useful when people can carry it into their calendar workflow instead of repeatedly checking the site.

Likely user outcomes:

- follow a person, community, or event series and see upcoming events on a calendar
- export a single event into a personal calendar
- subscribe to a calendar feed for a profile/community/event category
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

### Real Sync

Use Google Calendar API sync when VRDex needs durable update/delete behavior for user-selected events.

Benefits:

- better update semantics
- clearer user workflow for followed profiles or communities
- can support reminders and long-lived subscriptions later

Tradeoff:

- requires OAuth consent, token storage, disconnect behavior, sync error handling, quota management, and self-host operator setup

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

## Data Rules

Calendar output should include only public event data that is safe to expose:

- event title
- start/end time and timezone
- public summary
- canonical VRDex URL
- public world/community/profile references when allowed by visibility and opt-out rules
- cancellation/update state when modeled

Do not include private notes, moderation fields, private contact paths, unreviewed scraped data, or hidden/suppressed entities.

## Self-Hosting Notes

Self-hosted operators that enable Google Calendar sync will need their own Google Cloud OAuth or service-account configuration. Do not hard-code BASIC BIT calendar project IDs or secrets into committed defaults.

## Non-Goals For First Slice

- building calendar sync now
- final multi-provider calendar abstraction
- full event-subscription preference UI
- per-user Google OAuth token storage before the account and event-follow models are ready
