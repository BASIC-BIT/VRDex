# Event connectors and sync

## Review brief

Make VRDex the hub for a community's events. A community connects the places its events live, Google Calendar, Discord, its VRChat group calendar, and gives each connection a direction: import from it, export to it, both, or leave it alone. VRDex's own calendar stays the product's source of truth; connectors keep the copies right.

This builds on the Discord channel intake design (`2026-10-28-discord-event-intake-design.md`), whose channel binding becomes the first connector. It reuses the club operations queue for VRChat writes, the existing Discord gateway for Discord reads and writes, and the intake draft and publish paths for everything that enters VRDex. It replaces the callerless Google Calendar staging import.

BASIC settled the shape in chat on 2026-10-28 and 2026-10-29: tri-directional connectors plus a real bidirectional mode, Google Calendar and Notion through full OAuth as optional connections with the internal calendar primary, one authorized staffer performs an integration and it persists on the community, a Discord board channel with one bot-owned embed per upcoming or recent event, and the build order below. Recommendation labels record what was proposed and is now approved within this design, versus what the builder decides.

## Decisions and scope

| Status | Decision |
| --- | --- |
| Locked decision | VRDex's internal calendar is the product's source of truth. External calendars are optional connections. |
| Locked decision | Every connector has a direction: `import`, `export`, `bidirectional`, or `off`. |
| Locked decision | One staffer with `manage_integrations` (or a super admin) performs an integration; the connector persists on the community with that person as its authority. |
| Locked decision | Bidirectional is a built mode with the conflict rule below, not a deferral. |
| Locked decision | A Discord board channel holds one bot-owned embed per upcoming, active, or recently ended event. |
| Current recommendation | Exports and structured imports are deterministic field maps with no model call. The intake agent runs only for unstructured sources. |
| Current recommendation | An import overwrites only the fields its source carries. |
| Current recommendation | Structured imports enter VRDex as intake candidates and use the hold or autopublish machinery from the channel intake design. |
| Current recommendation | VRChat calendar writes are new club operation payload kinds executed by the community's collector account. |
| Current recommendation | The callerless Google Calendar staging import (`convex/_eventCalendarImports.ts`, its three tables and test) is deleted in the Google Calendar connector PR. |
| Current recommendation | Build order: channel intake on the connectors table, Discord board, Discord scheduled events, Google Calendar, VRChat calendar. Notion is a reserved kind. |
| Locked decision | Recurring events: connectors first expand external series into plain occurrences, one link each; the recurring events design (`2026-10-29-recurring-events-design.md`) then adds a VRDex series model and series-aware links, with a migration that groups existing occurrence links by external series. |
| Deferred | Notion connector. Per-field conflict timestamps. Reordering board messages. Attendee or RSVP sync in any direction. |

## Intent

BASIC runs a night today by having an agent create the Discord scheduled event, the VRChat group event, the announcement, and the VRDex listing one after another. Every other community does the same by hand or skips VRDex. The goal is that an event written once, wherever the organiser already writes it, ends up correct everywhere else, and that VRDex is the place that makes that true.

The risk is a sync that fights people: overwriting a hand edit the organiser meant, re-importing its own export as a change, or duplicating an event because two sources described it. The design spends its complexity on the link table that remembers what VRDex last saw and wrote for every external copy.

## Goals, non-goals, anti-goals

Goals:

- A community with Google Calendar in `import` mode gets VRDex listings, Discord scheduled events, a board embed, and a VRChat calendar entry from one calendar entry.
- A change in VRDex reaches every `export` and `bidirectional` copy within a minute. A change outside reaches VRDex within fifteen minutes, or seconds where the source pushes.
- A staffer can see every connector, its direction, its state, and the last time it moved, on one settings page.
- Nothing in any direction runs without a link row that records what VRDex saw and wrote.

Non-goals:

- Replacing Discord's or VRChat's event UI. Managing attendees, RSVPs, interested counts, or reminders.
- Posting announcement text to a channel (issue 121 stays separate; the board is not an announcement).
- Importing an organiser's whole personal calendar. A connector points at one calendar.
- Any model call in a sync job.

Anti-goals:

- VRDex overwrites a field the source does not carry.
- VRDex imports its own export as an edit and bumps the event's updated time in a loop.
- A hand-created Discord scheduled event and a Google Calendar entry for the same night become two VRDex events.
- A connector keeps writing after the staffer who authorised it lost their role.

## The model

### Connectors

New table `eventConnectors`, replacing `discordChannelBindings` from the channel intake design before that design ships:

| Field | Notes |
| --- | --- |
| `communityProfileId` | The community the connector belongs to. |
| `kind` | `discord_announcements`, `discord_board`, `discord_scheduled_events`, `google_calendar`, `vrchat_calendar`. `notion` is reserved and not implemented. |
| `direction` | `import`, `export`, `bidirectional`, `off`. Kinds restrict it: `discord_announcements` is import only; `discord_board` is export only. |
| `mode` | `hold` or `autopublish`. Applies to imports. |
| `authorityUserId` | The staffer who performed the integration. Actor of record for everything the connector does. |
| `credentialId` | Row in `connectorCredentials` for OAuth kinds. Absent for Discord kinds, which use the gateway bot, and for `vrchat_calendar`, which uses the collector account. |
| `target` | Kind-specific: `{guildId, channelId}` for Discord channel kinds, `{guildId}` for scheduled events, `{calendarId}` for Google, `{groupId, calendarId}` for VRChat. |
| `quietWindowSeconds` | Announcements only, as in the channel intake design. |
| `state` | `active`, `paused`, `needs_reauth`, `removed`. Paused when the authority loses `manage_integrations` or the bot loses access; `needs_reauth` when a token refresh fails. |
| `lastSyncedAt`, `lastError` | Shown on the settings page. |

One connector per kind per target per community. A connector never changes community; disconnect and reconnect.

### Credentials

New table `connectorCredentials`: `provider` (`google`), `ownerUserId`, `encryptedAccessToken`, `encryptedRefreshToken`, `accessTokenExpiresAt`, `scopes`, `externalAccountId` (the Google account's subject), `state` (`active`, `revoked`). Tokens are encrypted with AES-256-GCM under `VRDEX_CONNECTOR_TOKEN_KEY`, a 32-byte key held in the Convex deployment's environment and documented by name, scope, owner, and rotation path in `docs/deployment/convex-environments.md`. Refresh happens on demand inside the job that needs the token: on a 401, refresh once, re-encrypt, retry once; on refresh failure, set the connector to `needs_reauth` and stop. This is Chronote's pattern, with the state field it lacks.

A credential belongs to the person who granted it. A connector references it. If that person disconnects their Google account, every connector using it goes to `needs_reauth`, and another staffer can reconnect with their own account without recreating the connector.

### Links

New table `eventSyncLinks`, the heart of the design: one row per event per connector.

| Field | Notes |
| --- | --- |
| `eventId`, `connectorId` | Unique together. |
| `externalId` | The Google event ID, Discord scheduled event ID, Discord message ID for the board, or VRChat calendar event ID. |
| `lastExportedAt`, `lastExportedHash` | When VRDex last wrote this copy and a hash of the carried fields it wrote. |
| `lastImportedAt`, `externalUpdatedAt` | When VRDex last read it and the source's own updated time at that read. |
| `state` | `linked`, `external_deleted`, `vrdex_retracted`. |

The hash is the echo guard: an inbound change whose carried fields hash to `lastExportedHash` is VRDex's own export coming back and is ignored. The link row is also the dedupe: a source item with a link row updates that event; one without a link row is matched by community, date, and title before it is allowed to create a new event. The same match runs before any export creates a copy: an `export_upsert` with no link row first lists the target's upcoming items and links a match instead of creating a duplicate.

A link may carry `draftId` instead of `eventId` while a held import waits in My events, so a fifteen-minute poll does not file a second draft for the same item. While such a draft is pending, exports to that connector for that event are skipped, so a staffer's pending decision is not overwritten from the other direction.

### Connecting

Creating or re-enabling a connector enqueues one `reconcile` job. It lists the target's items from today to ninety days ahead, links every one that matches a VRDex event by community, date, and title, and, for `import` and `bidirectional`, enqueues `import_item` for the rest. For `export` and `bidirectional` it also enqueues `export_upsert` for every upcoming VRDex event in the community that has no link, so existing listings reach the target without waiting for an edit. Past items are never imported. This is what makes turning on a connector safe for a community that already keeps Discord and VRChat by hand: nothing upcoming is duplicated.

### Jobs

New table `eventSyncJobs`: `connectorId`, `eventId?`, `kind` (`reconcile`, `export_upsert`, `export_delete`, `import_item`, `import_poll`, `board_refresh`), `payload`, `dueAt`, `attempts`, `leaseExpiresAt`, `state` (`pending`, `running`, `done`, `failed`), `lastError`. Jobs are scheduled with `ctx.scheduler.runAfter` and claimed with a lease, following the existing `clubOperations` claim shape. Five attempts with backoff doubling from one minute; after that `failed`, counted on the connector's `lastError`, and visible on the settings page. One job per connector per event is pending at a time: enqueueing an `export_upsert` for an event that already has one pending replaces it.

Every event write in VRDex (publish, update, retract, from any path) ends by calling one function, `enqueueEventSync(ctx, eventId)`, which creates an `export_upsert` or `export_delete` for every `export` and `bidirectional` connector of the event's community. This is the only hook into existing event code.

VRChat jobs do not run the write themselves. They enqueue a club operation and complete when the operation completes; the operation's result carries the external ID back to the link row.

## Directions and field ownership

Each kind declares the fields it carries. Only those fields move, in either direction.

| Kind | Carries |
| --- | --- |
| `google_calendar` | title, start, end, summary, venueLabel (as location). |
| `discord_scheduled_events` | title, start, end, summary, venueLabel (as location). Export only: poster artwork as the cover image. |
| `vrchat_calendar` | title, start, end, summary. Export only: poster artwork, and the world name plus event URL appended to the description, since VRChat calendar entries have no world field. |
| `discord_board` | everything public on the event page, export only. |
| `discord_announcements` | whatever the intake agent extracts, import only. |

Poster and world never import through a connector; images are not downloaded from external copies. Lineup, world, poster, and every field a kind does not carry stay VRDex-owned on an imported event. A staffer editing those on VRDex is not fighting the sync.

**Cancellation and removal.** VRDex has four ways an event stops being live. `eventStatus: cancelled` exports as an update: Discord scheduled events are set to canceled, the board embed says Cancelled and stays until its normal 24-hour retirement, Google entries are set to cancelled, VRChat entries are deleted because VRChat has no cancelled state. Unpublishing to `draft_private`, contributor retraction, and moderation removal all run `export_delete`. Inbound, a Google `cancelled` status and a Discord canceled status are treated like an external deletion: the link is marked `external_deleted` and the event is flagged for staff, never cancelled automatically.

**Import.** A changed or new source item becomes an `EventIntakeCandidate` with every carried field marked `explicit` and evidence origin `connector`. The candidate then takes the same path as a channel intake run: `hold` files a draft that staff see in My events, `autopublish` publishes a new event or patches the linked one through the staff-level field patch. The decision is deterministic: a link row means `update`, a title and date match in the community means `update` to that event and a new link row, otherwise `new`. No model call.

**Export.** An `export_upsert` maps the event's carried fields to the kind's shape, creates or updates the external copy, and writes `externalId`, `lastExportedAt`, and `lastExportedHash` on the link. An `export_delete` runs on unpublish, retraction, or moderation removal and marks the link `vrdex_retracted`; it deletes the external copy on every kind. Cancellation is not a delete: see Cancellation and removal below.

**Bidirectional.** Both of the above, with one conflict rule: record-level last write wins. An inbound change is applied when `externalUpdatedAt` is newer than the event's `updatedAt` and the echo guard does not match; otherwise VRDex's state wins and the next export overwrites the copy. Per-field timestamps are deferred; the ceiling is that two different fields edited on both sides inside one sync interval resolve to one side, which the settings page's last-synced time makes diagnosable.

**Off.** No jobs. The connector keeps its link rows so turning it back on does not duplicate anything.

**Recurring items.** Until the recurring events design ships, an imported series is expanded into one VRDex event per occurrence within the next sixty days, each with its own link whose `externalId` is the occurrence instance ID and which also records the external series ID. A series edit at the source arrives as one `import_item` per changed occurrence. Exports never create series in this phase.

**External deletion.** An import that finds a linked item gone sets the link to `external_deleted` and flags the event for staff attention in My events, exactly like the channel intake deletion rule. VRDex never retracts a public event because an external copy vanished.

## The kinds

### Discord announcements

The channel intake design, unchanged except that the binding is an `eventConnectors` row of kind `discord_announcements`, direction `import`, and its run calls the shared decision and link machinery above.

### Discord board

**Who writes to Discord.** Convex actions call Discord's REST API directly with the bot token Convex already holds (`DISCORD_BOT_TOKEN`, used today by profile claims). The gateway stays what the channel intake design made it: an inbound relay that never writes. One bot identity, two processes, and the write path has no dependency on the gateway being up.

Export only. A channel the bot owns. On every `export_upsert` the job renders one embed: title, Discord timestamp tokens for start and end, community, world or venue, lineup rows, poster artwork as the image, and the event URL. It posts a new message or edits the linked one. A daily `board_refresh` job per connector removes messages for events that ended more than 24 hours ago and posts any upcoming event in the next 14 days that lacks a message. Messages are not reordered; the embed carries the time.

The bot needs Send Messages, Embed Links, and Manage Messages in that channel. The connector pauses with `lastError` if a write is refused.

### Discord scheduled events

Import, export, or bidirectional. Export creates an external-entity scheduled event with the location set to the world or venue label, or the event URL when neither exists, and the end time set to the event's end or start plus four hours when there is none, because Discord requires one. Import arrives through the gateway's `GuildScheduledEventCreate`, `Update`, and `Delete` events, relayed through the same HTTP action the announcements relay uses, as `import_item` jobs. The bot needs Manage Events in the server.

### Google Calendar

Import, export, or bidirectional. VRDex registers its own Google OAuth client, separate from the one Clerk uses for sign-in, with scopes `calendar.calendarlist.readonly` and `calendar.events`. The staffer authorises from the community settings page, picks one calendar from their list, and the connector is created with their credential. Import arrives through Google push notifications on a watch channel renewed every six days by a cron, with an `import_poll` every fifteen minutes as the fallback using the stored sync token. Export writes through the events API with the VRDex event URL in the description's last line.

The existing `eventImportBatches`, `eventImportCandidates`, and `eventImportCandidateFields` tables and `convex/_eventCalendarImports.ts` have no callers and are removed in this PR.

### VRChat calendar

Import, export, or bidirectional, available only to communities that already have an assigned collector account with calendar permission in the group. The club integration gains a `calendar` feature next to analytics, membership management, posts, and instances, and calendar operations require the `manage_events` permission. Export enqueues one of three new club operation payload kinds, `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`, carrying the carried fields and the artwork URL; the collector worker uploads the artwork to VRChat first, then executes the operation through the login host like every other operation and returns the calendar event ID. Exports use access type `group`, never send VRChat's creation notification (that is a message to every member, which the standing rule forbids), and truncate titles to VRChat's 64-character limit with an ellipsis. Import is an `import_poll` every thirty minutes that enqueues a `list_calendar_events` read operation and diffs the result against link rows. The curated event service in the vrchat-mcp repo is the reference for the VRChat endpoints.

### Notion

Reserved kind. Not built. The credentials table takes `provider: "notion"` without schema change when it is.

## Settings page

Community settings gains an Integrations section listing every connector: kind, target name, direction, mode, state, last synced, last error. Connect buttons per kind. A direction picker and a mode picker on each row. Disconnect per row. A connector in `needs_reauth` shows a Reconnect button that runs the OAuth flow again and swaps the credential.

The Discord section from the channel intake design folds into this one.

## Observability

Every job emits one PostHog event, `event_sync_job`, with kind, connector kind, direction, outcome, attempts, and duration, through the same outbox the channel intake design uses. The standing email alarm to `basic@basicbit.net` fires when any connector reaches five consecutive failed jobs or when the Google watch renewal has not succeeded in seven days, and a recovery email follows when the condition clears. There is no separate admin page for failures: the email and the settings page's last error are the surfaces (amended 2026-10-29). No model calls, so no Langfuse here.

## Rollout

Flag `VRDEX_EVENT_CONNECTORS_ENABLED` on Convex, default false, gating the settings section and all job execution. Each kind ships behind its own sub-flag until BASIC's community has run it for a week. First community is BASIC's, Google Calendar in `bidirectional`, the board, and scheduled events in `export`.

## Public copy

Every string needs BASIC's approval of the exact wording before it ships. Proposed:

| Surface | String |
| --- | --- |
| Settings section heading | Integrations |
| Connect buttons | Connect Google Calendar / Connect Discord / Connect VRChat calendar |
| Direction options | Import / Export / Both / Off |
| Direction help, import | Events there appear here. |
| Direction help, export | Events here appear there. |
| Direction help, both | Changes on either side reach the other. |
| Mode options | Hold for review / Publish automatically |
| State labels | Active / Paused / Needs reconnecting |
| Reconnect button | Reconnect |
| Disconnect button | Disconnect |
| Last synced | Synced `{relative time}` |
| Board channel kind label | Event board |
| Scheduled events kind label | Discord events |

No AI mention anywhere. No em-dashes.

## What is left to the builder

- Index design for the four new tables and expiry for job rows (suggest 30 days for done and failed jobs).
- The exact embed layout for the board, within the fields listed.
- Google watch channel bookkeeping (channel ID, resource ID, expiry) and where it lives (suggest fields on the connector).
- The collector worker implementation of the three calendar operation kinds and the read operation, with the vrchat-mcp curated event service as the reference.
- The title-and-date match rule for unlinked imports (suggest exact date and case-insensitive title match within the community).
- Test strategy. The echo guard, the carried-fields rule, the bidirectional conflict rule, the external deletion rule, the one-pending-job-per-event rule, and the pause-on-lost-role rule each need a test that fails if the rule breaks.
- PR split, one per kind in the build order, with the connectors, credentials, links, and jobs tables landing in the first PR alongside the channel intake rebuild.

## Open questions for BASIC

None at hand-over. Questions raised by the cold builder check are folded in above.
