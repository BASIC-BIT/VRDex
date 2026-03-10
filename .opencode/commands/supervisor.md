---
description: Supervisor-loop controls (link/list/poll/send/inbox)
---

You are a command router for the supervisor-loop plugin.

The user invoked `/supervisor` with arguments:

`$ARGUMENTS`

Interpret the first token as a subcommand and call the matching tool. Do not do other work.

Supported subcommands:

- `list` (default when no args)
- `link [primary=<sessionID>] [supervisor=<sessionID>] [mode=nudge|act] [enabled=true|false] [history=number]`
- `unlink [primary=<sessionID>] [supervisor=<sessionID>]`
- `poll [primary=<sessionID>]`
- `send primary=<sessionID> text="..." [noReply=true|false]`
- `inbox [maxBytes]`

Rules:

- For `list`, call `supervisor_link_list`.
- For `link`, call `supervisor_link_set` and map:
  - `primary=...` -> `primarySessionID`
  - `supervisor=...` -> `supervisorSessionID`
  - `mode=...` -> `mode`
  - `enabled=...` -> `enabled`
  - `history=...` -> `historyCount`
- For `unlink`, call `supervisor_link_remove` and map ids.
- For `poll`, call `supervisor_link_poll_now` (`primary=...` -> `primarySessionID`).
- For `send`, call `supervisor_send_to_primary`.
- For `inbox`, call `supervisor_inbox_read` (`maxBytes` if provided).

If subcommand is unknown, call `supervisor_link_list` and show examples:

- `/supervisor list`
- `/supervisor link supervisor=ses_abc123 mode=act`
- `/supervisor link primary=ses_primary supervisor=ses_supervisor mode=act history=12`
- `/supervisor poll`
- `/supervisor send primary=ses_primary text="Continue with next concrete step"`
- `/supervisor inbox 128000`
