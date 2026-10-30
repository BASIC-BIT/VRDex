/** Session seed and viewer-local authored date, with unambiguous component boundaries. */
export function discoveryRotationKey({ seed, localDate }: { seed: string; localDate: string }): string {
  return JSON.stringify([seed, localDate]);
}

/** FNV-1a provides repeatable tie ordering without time, popularity, or render randomness. */
export function discoveryRotationScore(rotationKey: string, entityId: string): number {
  const value = JSON.stringify([rotationKey, entityId]);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}
