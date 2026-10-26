// Synthetic, nonproduction resource fixtures. These are not measured evidence.
import { createCapacityResolver } from "../../workers/restream/broadcast-capacity.mjs";
import { VIDEO_PROFILES } from "../../workers/restream/broadcast-profiles.mjs";

export const syntheticAllocation = Object.freeze({
  cpuUnits: 4096,
  memoryMiB: 8192,
  evidenceId: "unit-test-synthetic-capacity-v1",
});
export const resolveSyntheticAllocation = createCapacityResolver(Object.freeze(
  Object.fromEntries(Object.keys(VIDEO_PROFILES).flatMap(preset =>
    [false, true].map(simulcast => [`${preset}:${simulcast}`, syntheticAllocation]),
  )),
));
