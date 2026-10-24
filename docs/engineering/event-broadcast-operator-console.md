# Event broadcast operator console

The authorized `/operate` view subscribes to `getEventMediaControlStatus`. It
selects the program's `activeSessionId`; a newer terminal session never replaces
that session. An unresolved replacement subscription does not fall back to old
permissions or source rows. Read-only operations staff retain diagnostics access.

## Control and observation

Desired source comes from committed intent. Pending source comes from the current
operation, including its Preparing or Promoting phase. Observed output requires
fresh encoded evidence: the source identity, revision, slot and output watermark,
plus the existing live lease and 15-second observation limit. A failed preparation
leaves committed intent and encoded output unchanged. Old revisions remain visible
as distinct identities after replacement.

Take uses the existing command API. Cancel is offered only during preparation.
Cut to slate has its own synchronous submission guard and does not wait behind an
ordinary request or preparation. Stop has priority over source controls and retains
its confirmation. Return to auto remains available in schedule gaps; the resulting
automatic slate is valid. Start retains admission, output reservation, and terminal
cleanup restrictions. No UI path bypasses the measured allocation map.

Custom sources use `eventMediaSources.create/replace/remove`. The authorized server
projection supplies `editable`; profile projections and lineup sources cannot be
edited as custom inputs. Replacing creates a new source identity and revision; it
does not rewrite an on-air record. The backend accepts only canonical VRCDN and
Twitch inputs. Provider liveness does not establish decoder readiness.

## Status windows and diagnostics

The source list shows four rows per page. Its status request prioritizes current,
next, preview, and visible sources, with at most four source IDs. The private
`/operate/status` route forwards the viewer token and checks the exact event path
before resolving those IDs against the authorized event. Unknown, foreign,
duplicate, oversized, and arbitrary URL parameters cannot initiate probes.

Host and operator routes import the same process-shared status reader. It permits
four concurrent probes, caches for 30 seconds and returns partial results within
ten seconds without queueing unstarted work. Client refresh waits 30 seconds after
completion, aborts on unmount, and has a 12-second fetch bound. Missing or older
than 60-second provider observations display Unknown. Links and copy actions remain
available during probe failures. The host reader can prioritize a preview only
when its canonical key belongs to that authorized/public roster.

Diagnostics is collapsed and uses the existing control subscription. Server time
plus browser monotonic elapsed time ages CPU and memory to Unknown at 30 seconds;
heartbeat updates do not refresh sample time. Allocation, provider, region, active
formats and dated compute-only rate remain separate from utilization. No resource
poll or operator CPU/memory setting was added.

## Settings, editor and local preview

Resolution and frame rate expose all six presets. Audio choices are 160/320 kbps;
new programs default to 320 and legacy programs remain 160. Twitch is always
160-kbps stereo/48-kHz AAC. Active session settings remain immutable while saved
settings apply on the next start.

The editor's Broadcast input field is separate from performer-sequence Stream.
It uses `getPersonBroadcastInputChoices({personSlug})`, preserves unavailable
explicit inputs, and emits null only for an explicit reset. Untimed conversion,
reorder, pending saves, dirty tracking and reload retain authored selection.
Changing a performer clears the prior input without changing legacy playback
semantics. Available choices are presentation metadata and never enter save args.

Preview owns a local adapter and foreground identity. It never calls the persistent
playback owner's Play or replaces its request. It starts muted. Monitor acquires
foreground audio synchronously before unmuting, and focus loss disposes the local
adapter. Close and navigation do not resume the program automatically.
Monitoring and provider status belong to the current local handle. Label changes
update metadata without replacing playback. Source or geometry replacements reset
keyboard/pointer interactivity synchronously before creating a muted adapter; they
require their own Monitor acquisition. Notifications from stopped or replaced
adapters cannot change the current handle's state, and current successful playback
clears an earlier Unavailable status.

Twitch preview uses the official SDK, passes initial muted state into construction,
and fences late SDK/READY callbacks after disposal. Its mount is inert to keyboard
and pointer input until Monitor. The actual visible mount must be at least
400 by 300 pixels, including at a 400-pixel viewport with card padding. Narrow or
nonvisible placements expose an external link; they do not create a clipped embed.

## Verification boundary

Pure view, route, editor persistence, foreground and fake SDK tests exercise source
contracts without services. Guarded browser fixtures exercise production components
with synthetic control receipts and intercepted playback; they are not authenticated
backend or provider rehearsals. Desktop/mobile browser execution, screenshots and
VLM review remain required before UI completion. Real Start remains blocked until
the measured allocation map is qualified; fixture Start does not establish capacity.
