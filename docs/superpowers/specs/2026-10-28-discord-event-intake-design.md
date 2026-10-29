# Discord channel event intake

## Review brief

Let a community point VRDex at one of its Discord channels. When an event announcement lands there, VRDex reads it, waits for the full context to arrive, runs the existing event intake agent, and either files a draft for staff or publishes directly. Later announcements that change an event update the listing instead of creating a second one.

This builds on the shipped intake agent from PR 348: poster and text extraction, the people and community lookup loop, local-time resolution, and the ten `vrdex_event_intake_*` MCP tools. It adds a Discord source, a durable quiet-window debounce, two agent tools for recognising existing events, an update path, and the observability the unattended path needs. It does not touch the website editor or the MCP contract.

BASIC approved the shape in chat on 2026-10-28: hold and autopublish modes, autopublish covering updates too, the quiet window, provenance on the Discord message and its author, channel connection from both the site and a slash command, and outbound publishing deferred. Recommendation labels below record what was proposed and is now approved within this design, versus what the builder decides.

## Decisions and scope

| Status | Decision |
| --- | --- |
| Locked decision | A channel binding is approved by community staff with `manage_integrations` or by a super admin, and carries a mode: `hold` or `autopublish`. |
| Locked decision | In `autopublish`, both new events and updates to existing events go live without a human step. |
| Locked decision | Provenance on every Discord-sourced change is the message URL and the Discord author. The approving staffer is the actor of record. |
| Locked decision | A quiet window delays every run until the channel stops changing. |
| Locked decision | Channels connect from the community settings page on the site or from a slash command run inside the channel. |
| Current recommendation | The gateway is a stateless relay. Debounce, the agent run, and all writes happen in Convex. |
| Current recommendation | The agent moves from `apps/web/src/lib/server/event-intake-agent.ts` into a workspace package so the web server and Convex run one implementation. |
| Current recommendation | Held drafts surface in the existing My events workspace as a section, not a new page. |
| Current recommendation | Every agent run, from any trigger, emits one Langfuse trace and one PostHog event. |
| Deferred | Outbound posting and keeping Discord posts updated (issue 121). Poster cropping or any image preprocessing. A cheap pre-classifier for non-event chatter. Verified message-content intent beyond 100 servers. Reading message history before the binding existed. |

## Intent

Promoters already write the announcement once, in Discord. Asking them to write it again in VRDex is the reason listings go stale. If the bot can read the channel, VRDex becomes correct by default for communities that opt in, and the cost of being listed drops to "connect the channel once".

The risk is a bot that confidently publishes wrong events, duplicates, or edits a listing a staffer just corrected by hand. The design spends its complexity on three things: waiting for the full message before reading it, telling new from existing, and leaving a trail a human can audit.

## Goals, non-goals, anti-goals

Goals:

- A connected channel in `autopublish` produces correct public events with no human step for ordinary announcements.
- A connected channel in `hold` produces drafts staff can approve in under a minute.
- A follow-up post or an edit to the original updates the same event.
- Every Discord-sourced event or edit shows its source message and author.
- Every agent run is traceable in Langfuse and countable in PostHog.

Non-goals:

- Posting to Discord. Replying in the channel. Reacting to messages.
- Reading channels the bot was not explicitly bound to.
- Back-filling events from history before the binding was created.
- Any change to the website editor, the public API, or the MCP tool list.

Anti-goals, outcomes that make this a failure even if it works:

- The bot edits a field a staffer set by hand on the site, from a message that did not mention that field.
- Two events for one announcement because the flyer arrived a minute after the text.
- A deleted or retracted Discord message silently taking a public event down.
- Copy on the site or in command replies that reads as corporate, AI-promotional, or patronising (see the copy table).

## Authority and labels

A binding is a staff decision, so what it produces carries the community's own authority, exactly as if the approving staffer had created or edited the event on the site. Discord-sourced events are not "Community-submitted" and are not locked to a contributor. This is the design's call, made because the contributor update path on main (`convex/eventCorrections.ts`) only edits events the same contributor created and refuses once staff have touched the event, which would make updates to site-created events impossible and would break after a single hand edit.

The run therefore writes through a staff-level path: publish creates the event as the community's own listing, and update is a new internal field-level patch mutation gated on the approver's current `manage_integrations` right, applied field by field and never as a whole-record replace. The existing contributor paths are untouched.

## Actors and trust

- **Approving staffer**: a VRDex user with `manage_integrations` on the community, or a super admin. Their `actorUserId` is the authority on every draft, publish, and update the binding produces. If their staff role is later removed, the binding pauses.
- **Discord author**: the account that posted the message. Recorded as provenance. If a `discordVerificationWatermarks` row links that Discord user ID to a VRDex user, the record also points at that user; otherwise only the Discord ID and display name at post time are kept.
- **The gateway**: holds a Discord bot token and one scoped secret for the Convex HTTP actions in this design, following the collector's pattern. It holds no deploy key, so it cannot call arbitrary functions or push code. It never calls OpenAI and never publishes.
- **The agent**: unchanged trust posture. Source content is untrusted data. Slugs come only from tool results. New in this design: an existing event slug may only come from the `list_events` tool.

## Connecting a channel

### From the site

Community settings gains a Discord section. The staffer clicks Connect Discord, which opens Discord's bot authorisation for a server they manage (Discord enforces Manage Server on its side). Back on VRDex, the page lists text channels the bot can read in that server. The staffer picks one, chooses `hold` or `autopublish`, and saves. The binding is active immediately for messages posted from then on.

A guild may already be attached to the community through `profileExternalLinks` with `assetType: discord_guild`. When it is, the page preselects that server. When it is not, saving the first binding also creates that link with `linkRole: secondary`, so the guild shows as connected elsewhere in the product. Builder's call whether that link creation lives in the same mutation.

### From Discord

A slash command run inside the target channel:

```text
/vrdex connect community:<autocomplete> mode:<hold|autopublish>
/vrdex disconnect
/vrdex status
```

The invoker must hold Manage Server in that Discord server. The command registers with `default_member_permissions` set to Manage Server, and the mutation checks the interaction's member permissions again, so the Discord-side check matches what Discord enforces at bot install on the site path. This stops a staffer of one community from piping another server's channel into theirs.

The invoker's Discord user ID is resolved through `discordVerificationWatermarks` to a VRDex user. If more than one VRDex user has applied that Discord ID, the command refuses with the "not linked" reply rather than guessing. Autocomplete offers only communities where that user has `manage_integrations` (or every community for a super admin). If the Discord account is not linked to VRDex, the reply says so and points at the site. The command path and the site path call the same Convex mutation, so the permission check is one function.

The `profileExternalLinks` row created by a first binding gets `linkedByUserId` set to the approver and no `verifiedByProofId`; it is an unverified link until the existing guild proof flow verifies it.

Command replies are ephemeral (visible only to the invoker).

### Binding record

Amendment, 2026-10-29: the binding is the first row of the general `eventConnectors` table defined in `2026-10-29-event-connectors-design.md`, with `kind: discord_announcements` and `direction: import`. The fields below map onto that table (`approvedByUserId` is `authorityUserId`, `guildId` and `channelId` live in `target`). The run's hold and autopublish steps become the shared decision and link machinery that design describes, so structured imports reuse them. Everything else in this document stands.

Fields the binding needs:

| Field | Notes |
| --- | --- |
| `guildId`, `channelId` | Discord snowflakes, validated with the existing `/^\d{17,20}$/` rule. One active binding per channel. |
| `communityProfileId` | The community that receives events. |
| `mode` | `hold` or `autopublish`. |
| `approvedByUserId` | Actor of record for everything this binding produces. |
| `quietWindowSeconds` | Default 120. Allowed range 30 to 600. Not exposed in the first UI; editable through the command's optional argument and by super admin. |
| `state` | `active`, `paused`, `removed`. Paused when the approver loses staff rights or the bot loses channel access. |
| `createdAt`, `updatedAt` | |

A binding never moves between communities; disconnect and reconnect instead.

## Reading the channel

### Gateway

`apps/discord-gateway` adds the `GuildMessages` and `MessageContent` intents (privileged; enabled in the developer portal, no verification needed under 100 servers) and handles `MessageCreate`, `MessageUpdate`, and `MessageDelete`. For each, if an active binding exists for the channel (looked up through one Convex query, cached in memory for a minute), it calls one internal mutation with:

- message ID, channel ID, guild ID, author ID and display name, created and edited timestamps
- text content
- attachments: for each image attachment, the CDN URL, content type, and size
- the kind of event: created, edited, deleted

The gateway keeps no other state. If it restarts, nothing is lost that Discord has already delivered, and nothing pending is lost because pending work lives in Convex.

Messages from bots, system messages, and messages with no text and no image attachment are dropped at the gateway.

### Message record

New table `discordIntakeMessages`: one row per Discord message per binding, upserted on edit, flagged on delete. Text is capped at 12,000 characters, matching the agent's input ceiling. Attachment URLs are stored as received; Discord signs CDN URLs with roughly a day of validity, so the run downloads them rather than anything later.

### Quiet window

A pending run is keyed by binding plus Discord author. Every create, edit, or delete from that author on that channel:

1. Upserts the message row and adds the message ID to the pending run's trigger set.
2. Cancels any scheduled run for that key (the scheduled function ID is stored on the pending `discordIntakeRuns` row).
3. Schedules a new run at now plus `quietWindowSeconds` with `ctx.scheduler.runAfter`.

So a text post, a flyer thirty seconds later, and a correction two minutes after that all land before the agent reads anything, and a restart of any process loses nothing. This is the Drasil manual-intake grace pattern made durable: Drasil holds the timer in process memory for 30 seconds; here the scheduler holds it.

A run's input is its trigger set (every message created, edited, or deleted from that author on that channel during the window) plus, for context, that author's other messages on the channel from the last six hours. An edit to a message from last week reschedules a run whose trigger set contains that message, which is how goal 3 holds.

A run is one debounced execution and nothing more. The durable link between Discord and VRDex is `discordIntakeSources`: one row per Discord message that contributed to a published event or a held draft, pointing at the event or draft. When a run's trigger set contains a message with such a row, the run tells the agent "message X previously produced event Y" in the input. The publish idempotency key is the run ID, so a second genuine announcement from the same author is a second run, a second key, and a second event.

The window is per author because announcement channels commonly have one poster per event; a second author's message in the same window gets its own run and relies on the agent's existing-event tools to avoid a duplicate. Candidate direction: if real channels show co-authored announcements, widen the key to the channel.

## The run

A Convex Node action, scheduled as above, does the following in order.

1. Load the run's trigger set and context messages. If every message is deleted, stop (see deletions below).
2. Download image attachments (largest first, at most three, 20 MB prepared-image ceiling as today). Store each through the existing poster source path so it can later be selected as artwork. Builder's call on the exact storage mechanics; the constraint is that `readPoster` works unchanged.
3. Create or reuse an `eventIntakeDrafts` row for the run, owned by `approvedByUserId`, with `sourceUrl` set to the newest message's URL and `sourceText` set to the messages joined in post order, each prefixed by its author display name and timestamp.
4. Run the agent with the run context (below).
5. Act on the decision according to the binding's mode.
6. Record the run: Langfuse trace, PostHog event, and a `discordIntakeRuns` row with the decision, the resulting draft or event, and the reason on failure.

### Agent changes

The agent gains two tools alongside `search_people`, `search_communities`, and `resolve_local_time`:

- `list_events(limit)`: the binding's community's events from seven days ago to ninety days ahead, plus any event a message in this run previously produced. Returns `slug`, `title`, `eventDate`, `start`, and a one-line lineup summary. At most 40 rows.
- `get_event(slug)`: the full public fields of one event the model got from `list_events`.

The candidate schema gains one field:

```text
decision: { kind: "new" } | { kind: "update", slug } | { kind: "not_event", reason }
```

Rules added to the instructions: a slug in `decision.update` may only come from `list_events`; prefer `update` when a message in this run previously produced that event or when title, date, and community match; choose `not_event` for chatter, reminders with no new facts, and messages about events in other communities. When a message in this run has already produced an event, the run tells the agent so in the input, so it does not have to guess.

The tool budget grows from three calls to five to make room for the two new tools. Turns stay at four. The existing website and MCP callers do not pass run context and get the same output they get today, with `decision` always `new`.

### Acting on the decision

| Decision | `hold` | `autopublish` |
| --- | --- | --- |
| `new` | Draft saved with `tentative` evidence; appears in My events. | Publish through the existing idempotent publish path as the community's own listing. Idempotency key is the run ID. |
| `update` | Draft saved with the target slug recorded; My events shows it as a proposed update. | Patch the event through the new staff-level field patch with `expectedUpdatedAt`. |
| `not_event` | Nothing visible. Run recorded. | Same. |

Update patches contain only fields the candidate marks with `explicit` evidence. Fields with `inferred` or no evidence are left out of the patch entirely, so a hand-set venue on the site survives a Discord post that only changes the start time. On a conflict (the event changed between `get_event` and the patch), the run records the conflict and files a `hold` draft instead of retrying.

Lineup is one field on the patch, so it follows one rule: when updating, the agent has the current lineup from `get_event` and must output the complete resulting lineup, with the change applied. The run sends `lineup` only when at least one `lineup.*` evidence entry is `explicit`; otherwise it leaves the lineup out. A post saying "X replaces Y" produces the full lineup with Y swapped for X, never a one-row lineup.

Publish authority today requires a published public community and caps publication at 10 per account per day and 100 per community per day, and `authorizeExtraction` caps model runs at 20 per actor per day. Discord runs bypass both per-account caps (one staffer may approve several busy channels, and chatter must not eat their own quota) and keep the per-community cap. In their place, each binding gets a cap of 20 runs per day; a binding that hits it pauses until the next day and the run is recorded with reason `binding_cap`.

### Deletions and retractions

A deleted Discord message never retracts a public event on its own. If every source message of an event is deleted, the run records `source_deleted`, and the event is flagged for staff attention in My events. Staff retract or keep it. This is deliberate: deletions in Discord are often tidying, not cancellation.

### Non-event chatter

Chatter runs through the full agent and costs a model call. The run records `not_event` and the PostHog event carries the reason, so the cost of chatter is visible. Add a cheap classifier only when the numbers say so.

## Held drafts in My events

The My events workspace (`apps/web/src/app/account/events`) gains a section listing drafts and proposed updates from Discord bindings for communities the user manages. Each row shows the extracted title and date, the community, the channel name, the author, a link to the source message, and three actions: open in the editor, publish as is, dismiss. Proposed updates show the target event and the changed fields before and after.

Any staffer with `manage_events` on the community can act on these rows, not only the approver. Draft access today is bound to one actor (`DRAFT_ACCESS`), so drafts created by a binding carry the binding ID and are readable and publishable by anyone with that right on the binding's community. Whoever clicks Publish becomes the actor of record on the receipt; the binding's approver stays the authority for runs. Dismiss keeps the draft row for thirty days with a dismissed state so the run history stays complete.

Opening in the editor is the existing wizard with the draft loaded; nothing new is built there.

### Where provenance shows

Source message and author are staff-facing: they appear on these rows, on `discordIntakeRuns`, and on the staff-attention rows for deleted sources. The event page has no edit-history surface today, so none is added here (amended 2026-10-29). The public event page does not change. A Discord display name and message link are not public metadata, and the public page stays owner-centred as the UI rule requires.

## Observability

### Langfuse

The agent's `record` hook today writes one console line. Replace it with a sink interface the host provides. The Convex and web hosts both pass a Langfuse sink that creates one trace per run, tagged with trigger (`discord`, `web`, `mcp`), binding ID when present, mode, and decision, and one generation per model turn with the request, response, token counts, and latency. Use the Langfuse JavaScript client directly; the LangChain wrapper used by the temporal runtime does not apply to raw fetch calls. The model's cost table gives `costUsd`; stop writing `null`.

Env on the Convex deployment and the web app: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`. Names, scope, and owner go in `docs/deployment/convex-environments.md` and the Vercel Terraform as the infrastructure rule requires; values stay in the provider secret stores. Missing keys disable tracing and never fail a run.

### PostHog

One server-side event per run, `event_intake_run`, with trigger, binding ID, community, mode, decision, reason, turns, tool calls, tokens, and duration. Deliver it through the existing `claimAnalyticsOutbox` and `claimAnalyticsDelivery` cron rather than a new pipeline; builder generalises the outbox row shape if it is claim-specific today. Web and MCP triggers emit the same event, so the funnel compares sources.

### Alarms

The gateway is the first VRDex process that runs unattended outside Vercel and Convex. The standing rule applies: it ships with an alarm whose action emails `basic@basicbit.net`, in the same PR. The gateway writes a heartbeat row to Convex every minute; a Convex cron raises the alarm when the heartbeat is older than five minutes and clears it when it returns. Builder's call on the mechanism, with the constraint that an alarm with no email action is not an alarm.

## Runtime and deployment

The gateway has no deployment today. It runs as one small container on the existing AWS account, defined in Terraform alongside the collector. It needs:

- `DISCORD_BOT_TOKEN` and `DISCORD_APPLICATION_ID` from Secrets Manager
- `CONVEX_SITE_URL` and a scoped secret for the intake HTTP actions, the collector's pattern, not a deploy key
- outbound HTTPS only

It is the same Discord application and the same process as the restream media-control bot documented in `docs/deployment/discord-gateway.md`; this design is the approval that document says privileged intents wait for. One application means a community installs one bot. That document is updated in the same PR that turns the intents on.

Slash commands register once per deploy through a script in the gateway package, not by hand.

The agent package: move `event-intake-agent.ts` to `packages/event-intake-agent` with its tests. It already takes every dependency as a closure (`fetchImplementation`, lookups, `readPoster`, `record`), so the move is a path change plus a `package.json`. The web host keeps `createEventIntakeExtractor`; the Convex host gets an equivalent that wires lookups to internal queries and `readPoster` to storage.

## Rollout

Flag `VRDEX_DISCORD_INTAKE_ENABLED` on Convex, default false. First binding is BASIC's own community on a channel BASIC controls, in `hold` mode, then `autopublish` after a week of clean runs. The bot stays under 100 servers, which keeps message-content access unverified.

## Public copy

Every string below is public-facing product copy and needs BASIC's approval of the exact wording before it ships. Proposed:

| Surface | String |
| --- | --- |
| Community settings section heading | Discord |
| Connect button | Connect Discord |
| Channel picker label | Channel |
| Mode options | Hold for review / Publish automatically |
| Mode help, hold | New events wait in My events until you approve them. |
| Mode help, autopublish | New events and changes go live as soon as they are read. |
| Disconnect button | Disconnect |
| My events section heading | From Discord |
| Row actions | Open / Publish / Dismiss |
| Proposed update label | Update to `{event title}` |
| Command reply, connected | Connected #`{channel}` to `{community}`. `{Mode}`. |
| Command reply, disconnected | Disconnected #`{channel}`. |
| Command reply, not linked | Link your Discord account on VRDex first: `{url}` |
| Command reply, no permission | You need to manage integrations for that community. |

No AI mention anywhere. No em-dashes.

## What is left to the builder

- Exact Convex table shapes beyond the fields named here (`discordChannelBindings`, `discordIntakeMessages`, `discordIntakeRuns`, `discordIntakeSources`), indexes, and expiry for message and run rows (suggest 30 days; source rows live as long as the event).
- The staff-level field patch mutation: its validator is the existing `event_update` patch shape, its gate is the approver's current `manage_integrations` right.
- How attachments reach poster storage from a Convex action.
- The Discord bot authorisation flow on the site: whether to reuse the existing Discord OAuth app or register a second one.
- Channel listing for the site picker (gateway query versus Discord REST from the web server).
- The alarm mechanism, within the constraint above.
- Outbox generalisation for PostHog.
- Test strategy, with the existing fake-fetch agent tests as the pattern. The quiet window, the per-author batching, the explicit-only update patch, and the deletion rule each need a test that fails if the rule breaks.
- PR split. A sensible order: agent package move and sinks; bindings, gateway, and the run in hold mode; autopublish and updates; My events section; deployment and alarm.

## Open questions for BASIC

None at hand-over. Questions raised by the cold builder check are folded in above.
