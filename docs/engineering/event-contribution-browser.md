# Browser event contribution

The browser intake at `/events/new` uses `eventIntake.saveEventIntakeDraft`,
`getEventIntakeDraft`, and `publishEventIntake`. The `community` query parameter
preselects a community. Saving sets a resumable `draft` URL and stays on the form.
Publishing replaces the route with the command's canonical `eventPath`.

```mermaid
flowchart LR
    Search[Events search] --> Add[Add event]
    Community[Community page, including no events] --> Add
    Account[Account events] --> Add
    Direct[Direct community or draft link] --> Auth[Sign in if needed]
    Add --> Auth
    Auth --> Intake[Manual, text or private poster intake]
    Intake --> Review[Accept tentative fields or edit manually]
    Review --> Intake
    Intake --> Save[Save draft and resume URL]
    Save --> Intake
    Intake --> Publish[Publish]
    Publish --> Event[Canonical event page]
    Event --> Correct[Original contributor correction or retraction]
    Event --> Staff[Staff takeover]
    Staff --> Owner
    Staff --> Suggest[Contributor suggestion in report inbox]
    Event --> Report[Report event]
    Report --> Inbox[Scoped staff report inbox]
    Suggest --> Inbox
    Account --> Owner[Managed owner editor and live controls]
    Owner --> Event
```

Timezones are selected from the runtime IANA list with city and regional aliases.
Abbreviations are search terms, not stored fixed offsets. Offsets use the event
date. Repeated local hours require an occurrence choice and missing local hours
cannot publish. Existing owner timestamps remain exact when unchanged.

The owner editor loads contributed date-only events with Time TBA selected.
Title, venue, artwork and lineup corrections preserve the authored date without
a start instant. Turning off Time TBA requires a start time. Contributed untimed
performers have editable names, optional person matches and roles, plus remove
controls. Lineup or schedule edits replace the canonical lineup and retain
unchanged timed-set stream selections. Content-only saves leave contributed
performer links unconfirmed. Existing timed owner events keep the
slot/participant editor.

`getEventContributionAccess` returns capabilities only. Contributor identifiers
stay out of the public event DTO. Correction mutations retain server authorization
and optimistic revision checks. Staff takeover closes direct contributor editing;
the subsequent suggestion goes through `reportEvent`, not a second store.
`/account/events/reports` checks staff access before querying its paginated inbox.

Manual intake remains available without extraction. Source text is private draft
input. `/api/event-intake` binds extraction and private poster operations to the
website session. Candidates remain tentative until accepted; artwork requires
a separate action on the currently previewed source. Replacing a poster never
selects it as artwork. See [source handling](../backend/event-intake-sources.md). Date-only publishing remains subject to the backend
`EVENT_DATE_ONLY_ENABLED` gate.

Browser fixtures test form behavior and navigation without a live Convex backend.
The intake fixture uses session storage. The owner fixture exercises the real
editor serialization through a local Convex transport. Neither proves a live
authenticated backend journey. Backend tests independently cover authorization,
publication, corrections, reports, and takeover.

The [integrated checkpoint](../testing/event-intake-checkpoint.md) records desktop/mobile
fixture screenshots, exact copy awaiting approval and the connected hosted journey
that remains unverified. Fixed public fixtures do not prove write persistence.
