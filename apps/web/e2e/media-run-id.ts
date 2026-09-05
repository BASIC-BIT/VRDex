/** Recovery handles must survive a killed runner, without depending on artifacts. */
export function mediaFixtureRunId(env: Record<string, string | undefined>) {
  let runId: string;
  if (env.GITHUB_RUN_ID !== undefined || env.GITHUB_RUN_ATTEMPT !== undefined) {
    if (!/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "") || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? "")) {
      throw new Error("Both GitHub run ID and attempt are required for media recovery.");
    }
    runId = `media-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  } else {
    runId = env.VRDEX_E2E_MEDIA_RUN_ID ?? "";
  }
  // Leave space for -contributor within clerkTestEmail's 48-character prefix.
  if (!/^media-[a-z0-9-]{1,26}$/.test(runId)) {
    throw new Error("Provide a durable media run ID (media- plus up to 26 lowercase letters, digits or hyphens).");
  }
  return runId;
}
