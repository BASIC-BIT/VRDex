export function authSessionMatrixIdentity(runId: string) {
  const normalizedRunId = runId
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()
    .slice(0, 48);
  const suffix = ["session", normalizedRunId]
    .join("-")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()
    .slice(0, 80);

  return {
    email: `${suffix}@e2e.vrdex.local`,
    password: `VRDex-${suffix}-password-12345`,
  };
}
