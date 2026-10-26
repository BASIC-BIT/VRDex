/** Import-safe argument seam; the wrapper owns process and environment effects. */
export function buildConvexCliArgs(
  args,
  { backendVersion, cloudPort, sitePort, isTTY, ci },
) {
  if (args[0] !== "dev" || !args.includes("--local")) return [...args];
  const hasArg = (name) =>
    args.some((arg) => arg === name || arg.startsWith(`${name}=`));
  const localFlags = [];
  if (!hasArg("--local-cloud-port") && !hasArg("--local-site-port")) {
    localFlags.push(
      "--local-cloud-port",
      cloudPort,
      "--local-site-port",
      sitePort,
    );
  }
  if (!hasArg("--local-force-upgrade") && (!isTTY || ci === "true")) {
    localFlags.push("--local-force-upgrade");
  }
  if (!hasArg("--local-backend-version") && backendVersion) {
    localFlags.push("--local-backend-version", backendVersion);
  }
  return [args[0], ...localFlags, ...args.slice(1)];
}
