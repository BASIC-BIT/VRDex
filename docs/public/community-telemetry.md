# Community telemetry

Community telemetry shows how a VRChat group and its group instances change over time. It is aggregate-only: VRDex records visible instance/world IDs, population counts, and the group's member count. This version does not collect the usernames or user IDs of people in an instance.

## Connect a group

An authorized community operator enters the immutable VRChat group ID and the group's join policy. VRDex assigns one of its own service accounts; it never asks for the operator's VRChat password or session cookie.

- Free Join: the account attempts to join.
- Request-to-Join: the account submits a request and waits for group approval.
- Invite-Only: the dashboard shows the VRDex service-account ID for an administrator to invite.

Collection begins only after the service account is a member and the provider exposes the group instances to it.

## Private analytics

The operator dashboard shows current population, active-instance history, per-instance population and lifecycle, peak concurrency, gap-aware player-hours, world distribution, group member count and growth, coverage, and collection health. Times render in the viewer's local timezone. Range controls cover 24 hours, 7 days, and 30 days.

Observed, estimated, stale, degraded, and unknown periods remain distinct. Solid chart segments are observed, dashed segments are estimated, and missing coverage is blank. An outage or visibility gap does not mean zero attendance. Current population is considered stale after six minutes without a successful observation, covering the five-minute healthy quiet cadence plus scheduling tolerance. Player-hours are integrated only between nearby observed samples, and every recap shows its coverage ratio.

Public history keeps missing bucket positions blank instead of drawing zero. Event recaps are emitted only for published canonical events.

Operators can confirm which instance session belongs to an event. Time/world overlap may create a private suggestion, but suggestions never publish until an authorized operator confirms them. A confirmed recap can include peak concurrency, player-hours, worlds, duration window, and coverage.

## Public controls

Everything is private by default. Operators enable each public field separately:

- current population
- population history
- group member count
- group member growth
- confirmed event recaps

The public community page, REST API, hosted MCP, and local stdio MCP use the same visibility result. Each listed switch controls one public surface; population history is a deliberate bundle of its documented rollup fields. Enabling one surface does not reveal another, internal collection health, raw observations, provider group ID, service-account identity, or account metadata.

Disconnecting stops new collection and removes every public telemetry field immediately. The assigned fenced worker then leaves the VRChat group and releases its account capacity; the private dashboard shows that cleanup as pending until it completes. Existing history remains private by default so a reconnect or operational recovery does not silently destroy analytics. A future deletion workflow may remove retained history separately.
