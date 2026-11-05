import { DeploymentSchema } from "../providers/config";
const providerFixtures: Record<string, string> = {
  bucket: "synthetic-plan-media",
  distributionOrigin: "https://media.invalid",
  signingKeyId: "SYNTHETICKEY",
};
/** Only these top-level provider-derived leaves may be unknown; never replace policy or binding values. */
export function verifyRuntimePlan(plan: {
  after: unknown;
  after_unknown: unknown;
}) {
  const after = structuredClone(plan.after) as {
    gateway: Record<string, unknown>;
    workers: Record<string, Record<string, unknown>>;
  };
  const unknown = plan.after_unknown as {
    gateway: Record<string, unknown>;
    workers: Record<string, Record<string, unknown>>;
  };
  if (
    !after?.gateway ||
    !after.workers ||
    !unknown?.gateway ||
    !unknown.workers
  )
    throw Error("Missing enabled runtime review output");
  const substitutions: string[] = [];
  function fill(
    value: Record<string, unknown>,
    mask: Record<string, unknown>,
    path: string,
    top = true,
  ) {
    for (const [key, child] of Object.entries(mask)) {
      if (child === false) continue;
      if (child === true) {
        if (
          !top ||
          !Object.hasOwn(providerFixtures, key) ||
          Object.hasOwn(value, key)
        )
          throw Error(
            `Unexpected unknown or policy replacement: ${path}.${key}`,
          );
        value[key] = providerFixtures[key];
        substitutions.push(`${path}.${key}`);
      } else if (child && typeof child === "object")
        fill(
          (value[key] ?? {}) as Record<string, unknown>,
          child as Record<string, unknown>,
          `${path}.${key}`,
          false,
        );
      else throw Error("Invalid unknown mask");
    }
  }
  fill(after.gateway, unknown.gateway, "gateway");
  DeploymentSchema.parse(after.gateway);
  const keys = Object.keys(after.workers);
  if (!keys.length || keys.length !== Object.keys(unknown.workers).length)
    throw Error("Missing worker output");
  for (const key of keys) {
    const worker = after.workers[key]!;
    fill(worker, unknown.workers[key] ?? {}, `workers.${key}`);
    const parsed = DeploymentSchema.parse(worker);
    if (!parsed.enabled || !parsed.binding)
      throw Error("Missing worker binding");
  }
  return { workers: keys.length, substitutions };
}
