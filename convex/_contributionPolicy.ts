// Sizing proposals. These are selectable only by an explicitly dedicated synthetic identity.
// Adding a hosted identity requires an owner-reviewed config change, never an env allowlist.
export const SYNTHETIC_CONTRIBUTION_DEPLOYMENTS = [
  "local:contributor-capacity-proof",
] as const;
const MiB = 1024 * 1024,
  GiB = 1024 * MiB;
const baseline = {
  openActor: 3,
  openTarget: 2,
  dailyActor: 6,
  dailyTarget: 20,
  burst: 1,
  burstWindowMs: 30_000,
  actorProcessing: 3,
  targetProcessing: 2,
  actorBytes: 144 * MiB,
  targetBytes: 96 * MiB,
  activeRows: 1000,
  retainedBatches: 1000,
  retainedRevisions: 10000,
};
const ordinary = {
  ...baseline,
  openActor: 100,
  openTarget: 10,
  dailyActor: 200,
  burst: 6,
  burstWindowMs: 60_000,
  actorProcessing: 2,
  actorBytes: 2 * GiB,
  targetBytes: 10 * 48 * MiB,
};
const trusted = {
  ...ordinary,
  openActor: 1000,
  dailyActor: 1000,
  burst: 12,
  actorProcessing: 4,
  actorBytes: 20 * GiB,
  activeRows: 10000,
  retainedBatches: 10000,
  retainedRevisions: 100000,
};
export function resolveContributionPolicy(
  env: Record<string, string | undefined> = process.env,
) {
  const version = env.VRDEX_CONTRIBUTION_POLICY ?? "baseline-v1";
  if (version !== "baseline-v1" && version !== "synthetic-v1")
    throw new Error("POLICY_UNKNOWN");
  if (
    version === "synthetic-v1" &&
    !SYNTHETIC_CONTRIBUTION_DEPLOYMENTS.some(
      (id) => id === env.CONVEX_DEPLOYMENT,
    )
  )
    throw new Error("POLICY_IDENTITY_DENIED");
  function bound(name: string, fallback: number) {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > Number.MAX_SAFE_INTEGER / 2
    )
      throw new Error("POLICY_BOUND_INVALID");
    return value;
  }
  return {
    version,
    ordinary: version === "baseline-v1" ? baseline : ordinary,
    trusted: version === "baseline-v1" ? baseline : trusted,
    // Proposed unmeasured operator choices, not universal production-safe limits.
    deploymentBytes: bound("VRDEX_CONTRIBUTION_DEPLOYMENT_BYTES", 100 * GiB),
    deploymentProcessing: bound(
      "VRDEX_CONTRIBUTION_DEPLOYMENT_CONCURRENCY",
      16,
    ),
    hostFetchesPerMinute: bound(
      "VRDEX_CONTRIBUTION_HOST_FETCHES_PER_MINUTE",
      30,
    ),
    paused: env.VRDEX_CONTRIBUTION_INTAKE_PAUSED === "true",
    bulkEnabled: env.VRDEX_CONTRIBUTION_BATCHES_ENABLED === "true",
  };
}
