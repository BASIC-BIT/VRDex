# Discord Gateway Service

## Status

Current recommendation for the first `program/restream/discord-gateway` leaf. The checked-in runtime is ACK/routing-only; it does not enqueue Convex commands or mutate live media.

## Runtime Shape

`apps/discord-gateway` is a dedicated long-running Discord Gateway adapter for VRDex media controls. It uses `discord.js` v14 on Node 22 and starts with only the `Guilds` intent.

The service is intentionally Gateway-first. Do not configure a Discord HTTP Interactions Endpoint URL for this app while interactions are delivered through Gateway events.

The first runtime entrypoint acknowledges interactions quickly and keeps provider mutation out of the package:

- It does not create or update Discord applications.
- It does not register global or guild commands.
- It does not mutate guild state.
- It does not request privileged intents.

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

Future Convex enqueue integration should add an explicit Convex deployment URL and a scoped service credential. Do not store stream keys, ingest URLs, or provider credentials in Discord messages, command payloads, logs, or ordinary event records.

## Provider Setup Still Needed

Provider setup remains manual until explicitly approved:

- Create separate staging and production Discord applications if practical.
- Invite the bot with the minimum scopes required for commands and bot operation.
- Register commands out-of-band after the command schema is finalized.
- Keep privileged intents disabled unless a later approved feature requires member, presence, or message content access.
- Leave the HTTP Interactions Endpoint URL empty for the Gateway-first app.
