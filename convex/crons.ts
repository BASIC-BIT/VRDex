import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly(
  "community telemetry rollups",
  { minuteUTC: 10 },
  internal.communityTelemetry.scheduleTelemetryRollups,
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

crons.interval(
  "expire abandoned recent authentication challenges",
  { minutes: 10 },
  internal.recentAuthChallenges.expireAbandoned,
  {},
);

export default crons;
