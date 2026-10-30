# Discord Gateway Service

## Status

Current recommendation for the first `program/restream/discord-gateway` leaf. Media controls in the checked-in runtime are ACK/routing-only; they do not enqueue Convex commands or mutate live media. The runtime also relays connected-channel posts to Convex and serves `/vrdex`.

## Runtime Shape

`apps/discord-gateway` is a dedicated long-running Discord Gateway adapter for VRDex media controls and Discord announcement intake. It uses `discord.js` v14 on Node 24 and requests the `Guilds`, `GuildMessages`, `MessageContent`, and `GuildScheduledEvents` intents. `MessageContent` is privileged: enable it in the Discord developer portal. Verification is not needed under 100 servers.

The service is intentionally Gateway-first. Do not configure a Discord HTTP Interactions Endpoint URL for this app while interactions are delivered through Gateway events.

The runtime entrypoint acknowledges interactions quickly and keeps provider mutation out of the package:

- It does not create or update Discord applications.
- It does not mutate guild state.
- It does not register commands at startup; `pnpm --filter @vrdex/discord-gateway register-commands` is the separate step that does.

## Announcement Intake

- Posts are relayed only from channels with an active `discord_announcements` connector, looked up per channel and cached for 60 seconds. Creates, edits, and deletes all follow this path. Convex ignores a create or update whose content and attachments match the stored row, and a repeat delete, so link unfurls, pins, and redelivery start no run.
- Bot posts, system messages, and posts with neither text nor an image are dropped. Image attachments are the only attachments relayed.
- At startup the runtime replays up to 100 posts per connected channel made while it was down, starting from the newest stored post. Channels with no stored post are skipped. Replays are safe to repeat because Convex upserts by message ID.
- A relay failure logs one JSON line with the message ID and is not retried. The post is recovered only if a later restart's replay still reaches it.
- `/vrdex connect`, `/vrdex disconnect`, and `/vrdex status` need Manage Server by default. `pnpm --filter @vrdex/discord-gateway register-commands` registers them globally through `DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN`. Rerun it when the command tree changes.
- The runtime posts a heartbeat to Convex at startup and every minute. Heartbeat failures log one JSON line and never stop the process.
- Each failure logs one JSON line. It may carry a message ID, a connector ID, an HTTP status, and a Discord numeric error code. Logs never carry the bot token, the intake secret, URLs, or message content.

Plan 05 owns deployment and the heartbeat alarm.

## Shared Media Command Routing

Discord controls route to the existing Convex media command model:

- `start` maps to `start_program`.
- `stop` maps to `stop_program`.
- `hold` maps to `switch_hold`.
- `next` maps to `next_slot`.
- `previous` maps to `previous_slot`.
- `source` maps to `switch_source` with `targetSourceKey` from a select menu.
- `fallback` maps to `force_direct_link_fallback` with submitted public fallback links.
- `publish_watch_link` maps to `publish_current_public_watch_link`.
- `refresh` updates the Discord panel and does not enqueue a media command.

Component `custom_id` values use compact routing hints in the form `vrdex:mc:<action>:<eventId>:r<revision>`. They are limited to Discord's 100-character `custom_id` cap and must not be treated as trusted authorization state.

## ACK And Stale Panel Behavior

Buttons and selects should immediately use `deferUpdate()` only when the server has loaded the current panel revision and verified that the component is current. Slash commands and modal submissions should immediately use ephemeral deferred replies.

If a component carries an old panel revision, or the runtime cannot verify freshness, the bot should send an ephemeral warning and avoid enqueueing a media command. Operators must refresh the panel before sending live controls from stale Discord components.

Dangerous live actions such as `stop` and `fallback` are marked confirmation-gated in the routing layer and do not expose an enqueueable command until confirmation succeeds. The first implementation records the routing contract; the confirmation UI and Convex enqueue call are follow-on integration work.

## Required Environment

- `DISCORD_BOT_TOKEN`: Discord bot token from the selected staging or production Discord application.
- `DISCORD_APPLICATION_ID`: that application's ID, read by `register-commands`.
- `CONVEX_SITE_URL`: the Convex HTTP actions origin for the matching deployment.
- `DISCORD_INTAKE_SECRET`: the same value as the Convex environment variable of that name.

Startup throws when `DISCORD_BOT_TOKEN`, `CONVEX_SITE_URL`, or `DISCORD_INTAKE_SECRET` is missing.

Future media enqueue integration should add a scoped service credential. Do not store stream keys, ingest URLs, or provider credentials in Discord messages, command payloads, logs, or ordinary event records.

## Local Control Demo

Use the local demo before provider setup to inspect the route-to-command contract and public media state projection:

```powershell
pnpm proof:restream:control
```

The demo writes `artifacts/restream-control-demo/<timestamp>/report.html` and `control-demo-summary.json`. It simulates fresh Discord controls, stale-panel rejection, confirmation-gated stop behavior, sanitized media commands, and public-safe state snapshots. It does not connect to Discord, enqueue Convex commands, or mutate event records.

## Provider Setup Still Needed

Provider setup remains manual until explicitly approved:

- Create separate staging and production Discord applications if practical.
- Invite the bot with the minimum scopes required for commands and bot operation.
- Register commands with `pnpm --filter @vrdex/discord-gateway register-commands` once per application.
- Enable the `MessageContent` privileged intent. Keep the other privileged intents disabled unless a later approved feature requires member or presence access.
- Leave the HTTP Interactions Endpoint URL empty for the Gateway-first app.
