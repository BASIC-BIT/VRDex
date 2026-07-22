import { v } from "convex/values";

export const TELEMETRY_ROLLUP_VERSION = "community-telemetry-v1";
export const ACTIVE_POLL_MIN_MS = 60_000;
export const ACTIVE_POLL_MAX_MS = 120_000;
export const QUIET_POLL_MIN_MS = 180_000;
export const QUIET_POLL_MAX_MS = 300_000;
export const INSTANCE_CLOSE_MISSES = 2;
export const MAX_INTERPOLATION_GAP_MS = 5 * 60_000;
export const CURRENT_FRESHNESS_MS = 6 * 60_000;

export const collectorAccountStateValidator = v.union(
  v.literal("provisioning"),
  v.literal("ready"),
  v.literal("degraded"),
  v.literal("cooldown"),
  v.literal("auth_required"),
  v.literal("quarantined"),
  v.literal("retiring"),
  v.literal("retired"),
);

export const collectorLeaseStateValidator = v.union(
  v.literal("active"),
  v.literal("released"),
  v.literal("expired"),
);

export const telemetryIntegrationStateValidator = v.union(
  v.literal("connecting"),
  v.literal("awaiting_approval"),
  v.literal("awaiting_invite"),
  v.literal("active"),
  v.literal("degraded"),
  v.literal("auth_required"),
  v.literal("disconnecting"),
  v.literal("disconnected"),
  v.literal("blocked"),
);

export const vrchatGroupJoinPolicyValidator = v.union(
  v.literal("free"),
  v.literal("request"),
  v.literal("invite"),
  v.literal("unknown"),
);

export const vrchatGroupVisibilityValidator = v.union(
  v.literal("public"),
  v.literal("private"),
  v.literal("unknown"),
);

export const telemetrySourceValidator = v.union(
  v.literal("first_party"),
  v.literal("vrcpop"),
  v.literal("vrcx"),
);

export const coverageStateValidator = v.union(
  v.literal("observed"),
  v.literal("estimated"),
  v.literal("stale"),
  v.literal("unknown"),
  v.literal("degraded"),
);

export const instanceSessionStateValidator = v.union(
  v.literal("open"),
  v.literal("closed"),
);

export const eventInstanceAssociationStateValidator = v.union(
  v.literal("suggested"),
  v.literal("confirmed"),
  v.literal("rejected"),
);

export const eventInstanceAssociationSourceValidator = v.union(
  v.literal("manual"),
  v.literal("time_world_overlap"),
);

export const publicTelemetrySettingsValidator = v.object({
  currentPopulation: v.boolean(),
  populationHistory: v.boolean(),
  groupMemberCount: v.boolean(),
  groupMemberGrowth: v.boolean(),
  eventRecaps: v.boolean(),
});

export type PublicTelemetryMetric =
  | "currentPopulation"
  | "populationHistory"
  | "groupMemberCount"
  | "groupMemberGrowth"
  | "eventRecaps";

export const DEFAULT_PUBLIC_TELEMETRY_SETTINGS: Record<PublicTelemetryMetric, boolean> = {
  currentPopulation: false,
  populationHistory: false,
  groupMemberCount: false,
  groupMemberGrowth: false,
  eventRecaps: false,
};

export type PopulationPoint = {
  observedAt: number;
  population: number;
  coverageState: "observed" | "estimated" | "stale" | "unknown" | "degraded";
  instanceKey: string;
  worldId: string;
};

export type CoverageWindow = {
  startedAt: number;
  endedAt?: number;
  state: "observed" | "estimated" | "stale" | "unknown" | "degraded";
};

export function randomPollDelayMs(active: boolean, random = Math.random): number {
  const minimum = active ? ACTIVE_POLL_MIN_MS : QUIET_POLL_MIN_MS;
  const maximum = active ? ACTIVE_POLL_MAX_MS : QUIET_POLL_MAX_MS;
  return Math.floor(minimum + random() * (maximum - minimum + 1));
}

export function retryDelayMs(attempt: number, retryAfterMs?: number, random = Math.random): number {
  const exponential = Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, Math.min(attempt, 8)));
  const base = Math.max(exponential, retryAfterMs ?? 0);
  return Math.floor(base * (0.8 + random() * 0.4));
}

export function redactProviderText(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text
    .replace(/authorization\s*[:=]\s*(?:(?:Bearer|Basic)\s+)?[A-Za-z0-9+/=._~-]+/gi, "authorization=[redacted]")
    .replace(/(auth(?:cookie)?|token|password|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9+/=._~-]+/gi, "$1 [redacted]")
    .slice(0, 500);
}

export function computePopulationMetrics(
  points: PopulationPoint[],
  rangeStart: number,
  rangeEnd: number,
  maxGapMs = MAX_INTERPOLATION_GAP_MS,
) {
  const sorted = [...points]
    .filter((point) => point.observedAt >= rangeStart && point.observedAt <= rangeEnd)
    .sort((left, right) => left.observedAt - right.observedAt);
  const totalsByTime = new Map<number, number>();
  const worlds = new Map<string, number>();

  for (const point of sorted) {
    if (point.coverageState !== "observed" && point.coverageState !== "estimated") {
      continue;
    }
    totalsByTime.set(point.observedAt, (totalsByTime.get(point.observedAt) ?? 0) + point.population);
    worlds.set(point.worldId, (worlds.get(point.worldId) ?? 0) + 1);
  }

  const totals = [...totalsByTime.entries()].sort((left, right) => left[0] - right[0]);
  let playerMinutes = 0;
  let measuredMs = 0;

  for (let index = 1; index < totals.length; index += 1) {
    const previous = totals[index - 1]!;
    const current = totals[index]!;
    const gap = current[0] - previous[0];
    if (gap <= 0 || gap > maxGapMs) {
      continue;
    }
    playerMinutes += ((previous[1] + current[1]) / 2) * (gap / 60_000);
    measuredMs += gap;
  }

  return {
    currentPopulation: totals.length > 0 ? totals[totals.length - 1]![1] : undefined,
    peakConcurrency: totals.reduce((peak, point) => Math.max(peak, point[1]), 0),
    playerMinutes,
    playerHours: playerMinutes / 60,
    measuredMs,
    coverageRatio: rangeEnd > rangeStart ? Math.min(1, measuredMs / (rangeEnd - rangeStart)) : 0,
    worlds: [...worlds.entries()]
      .map(([worldId, samples]) => ({ worldId, samples }))
      .sort((left, right) => right.samples - left.samples || left.worldId.localeCompare(right.worldId)),
  };
}
