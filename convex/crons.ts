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

export default crons;
