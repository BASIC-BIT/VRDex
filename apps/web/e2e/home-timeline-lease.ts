import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

type OwnedFixtureIds = {
  eventIds: string[];
  profileIds: string[];
  slotIds: string[];
  lineupEntryIds: string[];
};
type FixtureCounts = {
  events: number;
  profiles: number;
  slots: number;
  lineupEntries?: number;
};
type FixtureManifest = {
  recordCreated: (
    ownedIds: OwnedFixtureIds,
    expectedCounts: FixtureCounts,
  ) => Promise<void>;
  markClean: () => Promise<void>;
};

// Unique IDs isolate writes, but every real public query sees all concurrent
// runs at the fixed fixture date. Hold this cross-worker lease through cleanup.
export async function withTimelineFixtureLease<T>(
  backendUrl: string,
  run: (
    blockAfterCleanupFailure: () => void,
    manifest: FixtureManifest,
  ) => Promise<T>,
  {
    timeoutMs = 120_000,
    runId = "unknown",
    manifestDirectory = process.env.VRDEX_HOME_FIXTURE_MANIFEST_DIR ??
      join(process.cwd(), ".playwright-fixtures"),
  }: {
    timeoutMs?: number;
    runId?: string;
    manifestDirectory?: string;
  } = {},
): Promise<T> {
  const key = createHash("sha256")
    .update(new URL(backendUrl).origin)
    .digest("hex");
  const path = join(tmpdir(), `vrdex-home-timeline-${key}.lock`);
  const manifestPath = join(manifestDirectory, `${key}.json`);
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
    await handle.writeFile(`pid=${process.pid}\nrunId=${runId}\nmanifest=${manifestPath}\n`);
    const unresolved = await readFile(manifestPath, "utf8").catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    });
    if (unresolved !== null) {
      blocked = true;
      throw Error(`Timeline fixture cleanup failed; manifest ${manifestPath} requires recovery before another run`);
    }

    return await run(() => {
      blocked = true;
    }, {
      async recordCreated(ownedIds, expectedCounts) {
        await mkdir(manifestDirectory, { recursive: true });
        const pendingPath = `${manifestPath}.${process.pid}.pending`;
        const file = await open(pendingPath, "wx", 0o600);
        try {
          await file.writeFile(JSON.stringify({
            version: 1,
            runId,
            backendOrigin: new URL(backendUrl).origin,
            ownerPid: process.pid,
            createdAt: new Date().toISOString(),
            ownedIds,
            expectedCounts,
          }, null, 2));
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(pendingPath, manifestPath);
      },
      async markClean() {
        await unlink(manifestPath);
      },
    });
  } finally {
    await handle.close();
    if (blocked) {
      // Preserve the lease if cleanup is uncertain. Waiting workers fail closed
      // rather than publishing new fixed-date records alongside abandoned data.
      await writeFile(
        path,
        `cleanup-failed\npid=${process.pid}\nrunId=${runId}\nmanifest=${manifestPath}\n`,
      );
    } else {
      await unlink(path);
    }
  }
}
