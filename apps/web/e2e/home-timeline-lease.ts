import { createHash } from "node:crypto";
import { open, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

// Unique IDs isolate writes, but every real public query sees all concurrent
// runs at the fixed fixture date. Hold this cross-worker lease through cleanup.
export async function withTimelineFixtureLease<T>(
  backendUrl: string,
  run: (blockAfterCleanupFailure: () => void) => Promise<T>,
  {
    timeoutMs = 120_000,
    runId = "unknown",
  }: { timeoutMs?: number; runId?: string } = {},
): Promise<T> {
  const key = createHash("sha256")
    .update(new URL(backendUrl).origin)
    .digest("hex");
  const path = join(tmpdir(), `vrdex-home-timeline-${key}.lock`);
  const deadline = Date.now() + timeoutMs;
  let handle;
  while (!handle) {
    try {
      handle = await open(path, "wx");
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      )
        throw error;
      const owner = await readFile(path, "utf8").catch((readError: unknown) => {
        if (
          readError instanceof Error &&
          "code" in readError &&
          readError.code === "ENOENT"
        )
          return "";
        throw readError;
      });
      if (owner.startsWith("cleanup-failed"))
        throw new Error(
          `Timeline fixture cleanup failed; recover its owned records before removing ${path}: ${owner}`,
        );
      if (Date.now() >= deadline)
        throw new Error(
          `Timed out waiting for timeline fixture cleanup: ${path}. If its worker was interrupted, clean that run's records before removing the lease.`,
        );
      await setTimeout(Math.min(100, Math.max(1, deadline - Date.now())));
    }
  }
  let blocked = false;
  try {
    await handle.writeFile(`pid=${process.pid}\nrunId=${runId}\n`);
    return await run(() => {
      blocked = true;
    });
  } finally {
    await handle.close();
    if (blocked) {
      // Preserve the lease if cleanup is uncertain. Waiting workers fail closed
      // rather than publishing new fixed-date records alongside abandoned data.
      await writeFile(
        path,
        `cleanup-failed\npid=${process.pid}\nrunId=${runId}\n`,
      );
    } else {
      await unlink(path);
    }
  }
}
