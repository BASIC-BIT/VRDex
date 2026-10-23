import {
  parseMediaSettings,
  resolveDestinationProfile,
} from "./broadcast-profiles.mjs";
/** @typedef {{cpuUnits:number,memoryMiB:number,evidenceId:string}} WorkerAllocation */
const shapes = Object.freeze({
  1024: [2048, 3072, 4096, 5120, 6144, 7168, 8192],
  2048: [
    4096, 5120, 6144, 7168, 8192, 9216, 10240, 11264, 12288, 13312, 14336,
    15360, 16384,
  ],
  4096: Array.from({ length: 23 }, (_, i) => (i + 8) * 1024),
  8192: Array.from({ length: 12 }, (_, i) => (i * 4 + 16) * 1024),
});
export function validateShape({ cpuUnits, memoryMiB }) {
  if (
    !Number.isSafeInteger(cpuUnits) ||
    !Number.isSafeInteger(memoryMiB) ||
    !shapes[cpuUnits]?.includes(memoryMiB)
  )
    throw Error("Invalid Fargate allocation");
  return { cpuUnits, memoryMiB };
}
/** @param {unknown} value @returns {WorkerAllocation} */
export function parseAllocation(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "cpuUnits,evidenceId,memoryMiB"
  )
    throw Error("Invalid allocation snapshot");
  const { cpuUnits, memoryMiB, evidenceId } = /** @type {WorkerAllocation} */ (
    value
  );
  validateShape({ cpuUnits, memoryMiB });
  if (
    typeof evidenceId !== "string" ||
    !/^[-a-zA-Z0-9_.:]{8,128}$/.test(evidenceId)
  )
    throw Error("Invalid allocation evidence");
  return { cpuUnits, memoryMiB, evidenceId };
}
export function validateAllocationSnapshot(value) {
  if (!value?.mediaSettings) throw Error("Missing immutable media settings");
  const mediaSettings = parseMediaSettings(value.mediaSettings);
  const allocation = parseAllocation(value.allocation);
  const profiles = value.destinationProfiles;
  if (!Array.isArray(profiles) || profiles.length < 1 || profiles.length > 2)
    throw Error("Invalid destination snapshot");
  const ids = new Set(),
    destinations = new Set();
  const destinationProfiles = profiles.map((row) => {
    if (
      !row ||
      typeof row.outputId !== "string" ||
      !row.outputId ||
      ids.has(row.outputId) ||
      destinations.has(row.destination)
    )
      throw Error("Invalid destination snapshot");
    ids.add(row.outputId);
    destinations.add(row.destination);
    const expected = resolveDestinationProfile({
      settings: mediaSettings,
      destination: row.destination,
    });
    if (
      !row.profile ||
      Object.keys(row.profile).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([key, val]) => row.profile[key] !== val)
    )
      throw Error("Mismatched destination profile");
    return {
      outputId: row.outputId,
      destination: row.destination,
      profile: expected,
    };
  });
  if (
    !destinations.has("vrcdn") ||
    !destinationProfiles.some(
      (d) => d.destination === "vrcdn" && d.outputId === value.outputId,
    )
  )
    throw Error("Missing primary snapshot");
  return {
    mediaSettings,
    allocation,
    outputId: value.outputId,
    destinationProfiles,
  };
}
/** ECS v4 task CPU is vCPU; task memory and container memory are MiB.
 * Container CPU uses ECS CPU units. Read both endpoints and join Docker identity.
 */
export function validateTaskMetadata(snapshot, { task, container }) {
  const allocation = parseAllocation(snapshot.allocation);
  if (
    !/^arn:aws:ecs:[a-z0-9-]+:\d{12}:task\//.test(task?.TaskARN ?? "") ||
    !container?.DockerId ||
    !container?.Name
  )
    throw Error("Missing trusted task identity");
  const actual = task.Containers?.find(
    (c) => c.DockerId === container.DockerId && c.Name === container.Name,
  );
  if (
    !actual ||
    task.Limits?.CPU * 1024 !== allocation.cpuUnits ||
    task.Limits?.Memory !== allocation.memoryMiB ||
    [actual, container].some(
      (c) =>
        c.Limits?.CPU !== allocation.cpuUnits ||
        c.Limits?.Memory !== allocation.memoryMiB,
    )
  )
    throw Error("Actual task/container allocation mismatch");
  return allocation;
}
