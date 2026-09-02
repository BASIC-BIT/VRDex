import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly(
  "community telemetry rollups",
  { minuteUTC: 10 },
  internal.communityTelemetry.scheduleTelemetryRollups,
  {},
);

// Scheduled delivery is the fast path. This sweep recovers a row whose action
// runtime died after taking its lease but before recording success or retry.
crons.interval(
  "deliver claim analytics outbox",
  { minutes: 5 },
  internal.claimAnalyticsDelivery.deliverPending,
  {},
);

// Fast retries dead-letter after five attempts so one bad destination cannot
// monopolize delivery. This bounded hourly sweep makes temporary provider
// outages recover automatically without turning claim writes into a dependency.
crons.hourly(
  "recover stalled claim analytics deliveries",
  { minuteUTC: 5 },
  internal.claimAnalytics.recoverUndeliveredDeliveries,
  {},
);

crons.daily(
  "delete delivered claim analytics transport rows",
  { hourUTC: 4, minuteUTC: 5 },
  internal.claimAnalytics.sweepDeliveredEvents,
  {},
);

crons.daily(
  "community telemetry raw compaction",
  { hourUTC: 4, minuteUTC: 20 },
  internal.communityTelemetry.scheduleTelemetryCompaction,
  {},
);

crons.hourly(
  "expire stale profile verification attempts",
  { minuteUTC: 35 },
  internal.profileClaims.expireStaleVerificationAttempts,
  {},
);

// Hourly rather than daily: proofs revalidate on one shared 30-day window and
// arrive in bursts, so a daily pass let the tail stay active past its window.
crons.hourly(
  "mark overdue external control proofs stale",
  { minuteUTC: 15 },
  internal.profileConnections.markOverdueControlProofsStale,
  {},
);

// A digest rather than a message per submission: `/support` accepts anonymous
// requests, so per-submission delivery would hand anyone with a script a way to
// flood the mailbox this exists to make useful. One email an hour is the ceiling
// no matter what arrives, and an unread hour costs a request nothing.
crons.hourly(
  "mail new support requests",
  { minuteUTC: 25 },
  internal.supportRequestDigest.sendSupportDigest,
  {},
);

// Every other cleanup path is driven by a request, and the one leak that matters
// is shaped exactly like the case no request returns for: a key written by a
// POST that died after a revoke had already cancelled its reservation. Daily is
// ample — the rows are durable and the window they close is measured in the
// reservation TTL, not in minutes.
crons.daily(
  "retire abandoned VRCLinking delegation keys",
  { hourUTC: 5, minuteUTC: 40 },
  internal.vrclinkingCredentials.sweepAbandonedDelegationKeys,
  {},
);

export default crons;
