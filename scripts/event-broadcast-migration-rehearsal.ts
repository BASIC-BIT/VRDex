/** Import-safe driver. Only the explicit CLI entry opens HTTP connections. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import {
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReturnType,
  type ApiFromModules,
} from "convex/server";
import { api } from "../convex/_generated/api";
import type * as fixture from "../convex/localEventBroadcastRehearsal";
import type * as migration from "../convex/eventMediaControlMigration";

export type RehearsalClient = Pick<ConvexHttpClient, "mutation" | "query">;
type Client = RehearsalClient;
type RehearsalApi = ApiFromModules<{
  localEventBroadcastRehearsal: typeof fixture;
  eventMediaControlMigration: typeof migration;
}>;
type Seed = RehearsalApi["localEventBroadcastRehearsal"]["seed"];
type Scenario = RehearsalApi["localEventBroadcastRehearsal"]["setScenario"];
type Inspect = RehearsalApi["localEventBroadcastRehearsal"]["inspect"];
type Cleanup = RehearsalApi["localEventBroadcastRehearsal"]["cleanup"];
type Backfill = RehearsalApi["eventMediaControlMigration"]["backfill"];
const seedRef = makeFunctionReference<
  "mutation",
  FunctionArgs<Seed>,
  FunctionReturnType<Seed>
>("localEventBroadcastRehearsal:seed");
const scenarioRef = makeFunctionReference<
  "mutation",
  FunctionArgs<Scenario>,
  FunctionReturnType<Scenario>
>("localEventBroadcastRehearsal:setScenario");
const inspectRef = makeFunctionReference<
  "query",
  FunctionArgs<Inspect>,
  FunctionReturnType<Inspect>
>("localEventBroadcastRehearsal:inspect");
const cleanupRef = makeFunctionReference<
  "mutation",
  FunctionArgs<Cleanup>,
  FunctionReturnType<Cleanup>
>("localEventBroadcastRehearsal:cleanup");
const migrationRef = makeFunctionReference<
  "mutation",
  FunctionArgs<Backfill>,
  FunctionReturnType<Backfill>
>("eventMediaControlMigration:backfill");
type Inputs = {
  url: string;
  runId: string;
  sourceSha: string;
  backendVersion: string;
};
export function validateRehearsalInputs(input: Inputs) {
  const url = new URL(input.url);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error("Explicit loopback HTTP origin required.");
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(input.runId))
    throw Error("Invalid runId.");
  if (!/^[0-9a-f]{40}$/.test(input.sourceSha))
    throw Error("Source SHA required.");
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(input.backendVersion))
    throw Error("Backend version required.");
  return input;
}
type Evidence = { label: string; data: unknown };
type Receipt = {
  schemaVersion: 1;
  sourceSha: string;
  backendVersion: string;
  runId: string;
  scope: "migration" | "whole-flow";
  status: "passed" | "failed";
  failedStage: string | null;
  migrationCalls: number;
  evidence: Evidence[];
  cleanup: { status: "passed" | "failed"; deleted: number };
};
type DriverInput = Omit<Inputs, "url"> & {
  admin: Client;
  owner?: Client;
  bridgeToken?: string;
};

async function bounded<T>(
  operation: () => Promise<T>,
  deadline: number,
): Promise<T> {
  const remaining = Math.min(10_000, deadline - Date.now());
  if (remaining <= 0) throw Error("Rehearsal deadline exceeded.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Rehearsal call deadline exceeded.")),
          remaining,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Historical-only is a separate evidence scope; whole-flow also requires actual admission. */
export async function runMigrationRehearsal(
  input: DriverInput,
): Promise<Receipt> {
  validateRehearsalInputs({ ...input, url: "http://127.0.0.1" });
  const { admin, runId } = input;
  const deadline = Date.now() + 180_000;
  const receipt: Receipt = {
    schemaVersion: 1,
    sourceSha: input.sourceSha,
    backendVersion: input.backendVersion,
    runId,
    scope: input.owner ? "whole-flow" : "migration",
    status: "failed",
    failedStage: null,
    migrationCalls: 0,
    evidence: [],
    cleanup: { status: "failed", deleted: 0 },
  };
  let stage = "seed";
  const call = <T>(operation: () => Promise<T>) => bounded(operation, deadline);
  const evidence = (label: string, data: unknown) => {
    const item = { label, data };
    if (
      Buffer.byteLength(
        JSON.stringify({ ...receipt, evidence: [...receipt.evidence, item] }),
      ) >
      500 * 1024
    )
      throw Error("Receipt limit exceeded.");
    receipt.evidence.push(item);
  };
  const snapshot = () => call(() => admin.query(inspectRef, { runId }));
  const scenario = (name: FunctionArgs<Scenario>["case"]) =>
    call(() => admin.mutation(scenarioRef, { runId, case: name }));
  const migrate = (request: FunctionArgs<Backfill>) => {
    if (++receipt.migrationCalls > 256)
      throw Error("Migration call limit exceeded.");
    return call(() => admin.mutation(migrationRef, request));
  };
  try {
    const manifest = await call(() => admin.mutation(seedRef, { runId }));
    stage = "isolation";
    await scenario("assert-migration-isolation");
    stage = "quiescence";
    for (const name of [
      "scheduled",
      "starting",
      "live",
      "hold",
      "fallback",
      "stopping",
      "dispatch-unconfirmed",
      "task-queued",
      "task-running",
      "task-starting",
      "task-stopping",
      "task-failed",
      "task-legacy",
    ] as const) {
      await scenario(name);
      const before = await snapshot();
      await assert.rejects(
        migrate({ batchSize: 1 }),
        /no open sessions|stop must be confirmed/,
      );
      assert.deepEqual(await snapshot(), before);
      evidence(name, { rejected: true, unchanged: true });
      await scenario("ended-baseline");
    }
    await scenario("task-confirmed");
    stage = "migration";
    const phases = new Set<string>();
    for (let pass = 0; pass < 2; pass++) {
      const beforePass = pass === 1 ? await snapshot() : null;
      let request: FunctionArgs<Backfill> = {
        phase: "eventMediaSources",
        cursor: null,
        batchSize: 1,
      };
      let pages = 0;
      while (true) {
        phases.add(request.phase ?? "eventMediaSources");
        const response = await migrate(request);
        assert.ok(response.processed <= 1);
        const beforeReplay = await snapshot();
        assert.deepEqual(await migrate(request), response);
        assert.deepEqual(await snapshot(), beforeReplay);
        evidence("migration-page", {
          pass,
          request,
          response,
          replayUnchanged: true,
        });
        if (pass === 0 && ++pages === 2) {
          await scenario("live");
          await assert.rejects(
            migrate({
              phase: response.phase,
              cursor: response.cursor,
              batchSize: 1,
            }),
            /no open sessions/,
          );
          await scenario("ended-baseline");
          evidence("between-pages", { rejected: true });
        }
        if (response.done) break;
        request = {
          phase: response.phase,
          cursor: response.cursor,
          batchSize: 1,
        };
      }
      if (beforePass) assert.deepEqual(await snapshot(), beforePass);
    }
    assert.equal(phases.size, 3);
    const migrated = await snapshot();
    const session = (name: string) => {
      const found = migrated.sessions.find((s) => s.case === name);
      assert.ok(found);
      return found;
    };
    for (const name of ["automatic", "explicit"])
      assert.deepEqual(session(name).committedIntent, { kind: "automatic" });
    for (const name of ["manual-one", "manual-observed", "internal"]) {
      const source = migrated.sources.find((s) => s.key === name);
      assert.ok(source);
      assert.deepEqual(session(name).committedIntent, {
        kind: "manual",
        sourceId: source.id,
        revision: name === "manual-observed" ? 2 : 1,
      });
    }
    for (const name of [
      "hold",
      "manual-ambiguous",
      "manual-stale",
      "disabled",
      "removed-link",
      "hidden-link",
      "hidden-profile",
      "missing",
      "foreign",
    ])
      assert.deepEqual(session(name).committedIntent, { kind: "slate" });
    assert.equal(session("explicit").intentSequence, 99);
    for (const row of migrated.sessions) {
      if (row.case !== "explicit") {
        assert.equal(row.pendingControlCommandId, null);
        assert.equal(row.intentSequence, 7);
      }
    }
    for (const row of migrated.commands.filter((c) =>
      c.case.startsWith("pending-"),
    )) {
      assert.equal(row.status, "cancelled");
      assert.equal(row.controlOutcome, "superseded");
    }
    assert.equal(
      migrated.commands.find((c) => c.case === "completed")?.status,
      "succeeded",
    );
    assert.equal(
      migrated.commands.find((c) => c.case === "completed")?.sequence,
      77,
    );
    assert.equal(
      migrated.commands.find((c) => c.case === "cancelled")?.status,
      "cancelled",
    );
    assert.equal(
      migrated.sources.find((s) => s.key === "disabled")?.state,
      "disabled",
    );
    assert.equal(
      migrated.sources.find((s) => s.key === "internal")?.input,
      null,
    );
    assert.equal(
      migrated.profiles.find((p) => p.outboundLinks.length === 0)?.outboundLinks
        .length,
      0,
    );
    evidence("historical-result", migrated);
    if (input.owner) {
      stage = "protocol-lifecycle";
      assert.ok(input.bridgeToken);
      await runProtocolScenarios({
        owner: input.owner,
        admin,
        manifest,
        bridgeToken: input.bridgeToken,
        call,
        scenario,
        snapshot,
        evidence,
      });
    }
    receipt.status = "passed";
  } catch {
    // Errors can contain request credentials; persist only our fixed stage label.
    receipt.failedStage = stage;
  } finally {
    try {
      const result = await bounded(
        () => admin.mutation(cleanupRef, { runId }),
        Date.now() + 30_000,
      );
      receipt.cleanup = { status: "passed", deleted: result.deleted };
    } catch {
      receipt.cleanup = { status: "failed", deleted: 0 };
      receipt.status = "failed";
      receipt.failedStage ??= "cleanup";
    }
  }
  assert.ok(Buffer.byteLength(JSON.stringify(receipt)) <= 512 * 1024);
  return receipt;
}

type ProtocolInput = {
  owner: Client;
  admin: Client;
  manifest: FunctionReturnType<Seed>;
  bridgeToken: string;
  call: <T>(fn: () => Promise<T>) => Promise<T>;
  scenario: (name: FunctionArgs<Scenario>["case"]) => Promise<null>;
  snapshot: () => Promise<FunctionReturnType<Inspect>>;
  evidence: (label: string, data: unknown) => void;
};
async function runProtocolScenarios({
  owner,
  admin,
  manifest,
  bridgeToken,
  call,
  scenario,
  snapshot,
  evidence,
}: ProtocolInput) {
  const currentSlug = manifest.slug;
  const source = (await snapshot()).sources.find((s) => s.key === "manual-one");
  assert.ok(source);
  let sequence = 0;
  const configure = () =>
    call(() =>
      owner.mutation(api.events.configureVrcdnOutput, {
        currentSlug,
        key: "rehearsal",
        label: "Local rehearsal",
        outputAccountKey: "local-rehearsal",
        sourceConsentAccepted: true,
        destinationAuthorityAccepted: true,
        providerRulesAccepted: true,
        rightsClearedMediaAccepted: true,
        playbackLinks: [
          {
            platform: "browser",
            url: "https://stream.vrcdn.live/live/rehearsal_output.live.ts",
          },
        ],
      }),
    );
  const start = async () => {
    const output = await configure();
    const scheduled = await call(() =>
      owner.mutation(api.events.scheduleEventMediaWorker, {
        currentSlug,
        startImmediately: true,
      }),
    );
    const base = {
      bridgeToken,
      eventId: manifest.eventId,
      sessionId: scheduled.sessionId,
      workerId: `rehearsal-${++sequence}`,
      epoch: 0,
    };
    for (const protocolVersion of [undefined, 0, 1, 3])
      await assert.rejects(
        call(() =>
          admin.mutation(api.eventMediaWorker.acquireSession, {
            ...base,
            ...(protocolVersion === undefined ? {} : { protocolVersion }),
          }),
        ),
        /protocol 2/,
      );
    const lease = await call(() =>
      admin.mutation(api.eventMediaWorker.acquireSession, {
        ...base,
        protocolVersion: 2,
      }),
    );
    assert.ok(lease.granted);
    assert.deepEqual(lease.configuration.committedIntent, {
      kind: "automatic",
    });
    assert.equal(lease.configuration.intentSequence, 0);
    assert.equal(lease.configuration.pendingOperation, null);
    const args = { ...base, protocolVersion: 2, epoch: lease.epoch };
    const claims = await call(() =>
      admin.mutation(api.eventMediaWorker.claimCommands, args),
    );
    assert.ok(claims.granted);
    assert.ok(
      claims.commands.every(
        (c) =>
          c.sessionId === scheduled.sessionId &&
          c.commandType === "start_program",
      ),
    );
    evidence("real-admission", {
      allocation: lease.configuration.allocation,
      mediaSettings: lease.configuration.mediaSettings,
      destinationProfiles: lease.configuration.destinationProfiles,
    });
    return { args, output, deadline: lease.configuration.sessionDeadline };
  };
  const end = async (
    sessionId: FunctionReturnType<Inspect>["sessions"][number]["id"],
  ) => {
    await call(() =>
      owner.mutation(api.events.stopEventMediaWorker, {
        currentSlug,
        sessionId,
      }),
    );
    await call(() =>
      owner.mutation(api.events.markEventMediaWorkerEnded, {
        currentSlug,
        sessionId,
      }),
    );
  };
  const take = async (f: Awaited<ReturnType<typeof start>>) => {
    const result = await call(() =>
      owner.mutation(api.events.queueEventMediaCommand, {
        currentSlug,
        type: "switch_source",
        targetSourceKey: "manual-one",
        idempotencyKey: `take-${++sequence}`,
      }),
    );
    const row = (await snapshot()).commands.find(
      (c) => c.id === result.commandId,
    );
    assert.ok(row?.sequence && row.controlTarget);
    const control = { commandId: row.id, sequence: row.sequence };
    assert.equal(
      (
        await call(() =>
          admin.mutation(api.eventMediaWorker.beginPreparation, {
            ...f.args,
            ...control,
          }),
        )
      ).kind,
      "ok",
    );
    return { ...control, target: row.controlTarget };
  };
  const ack = (
    f: Awaited<ReturnType<typeof start>>,
    op: Awaited<ReturnType<typeof take>>,
  ) =>
    call(() =>
      admin.mutation(api.eventMediaWorker.acknowledgeCommand, {
        ...f.args,
        commandId: op.commandId,
        sequence: op.sequence,
        outcome: "succeeded",
        intentSequence: op.sequence,
        outputMs: 100,
        observedSourceId: source.id,
        sourceRevision: 1,
        slotKey: `manual-${source.id}`,
        observedOutputId: f.output.outputId,
        observedState: "live",
      }),
    );
  const observe = (
    f: Awaited<ReturnType<typeof start>>,
    op: Awaited<ReturnType<typeof take>>,
  ) =>
    call(() =>
      admin.mutation(api.eventMediaWorker.observeProgram, {
        ...f.args,
        intentSequence: op.sequence,
        outputMs: 101,
        publishing: true,
        sourceId: source.id,
        sourceRevision: 1,
        slotKey: `manual-${source.id}`,
        outputId: f.output.outputId,
        state: "live",
        mode: "manual",
      }),
    );
  for (const mode of [
    "manual-completed",
    "promoting-complete",
    "promoting-expired",
  ] as const) {
    const f = await start();
    const op = await take(f);
    assert.equal(
      (
        await call(() =>
          admin.mutation(api.eventMediaWorker.promoteOperation, {
            ...f.args,
            ...op,
          }),
        )
      ).kind,
      "ok",
    );
    const before = (await snapshot()).commands.find(
      (c) => c.id === op.commandId,
    );
    assert.ok(before?.preparationExpiresAt);
    if (mode === "manual-completed") {
      const result = await ack(f, op);
      assert.ok("kind" in result);
      assert.equal(result.kind, "ok");
    }
    await scenario("expire-lease");
    const replacement = await call(() =>
      admin.mutation(api.eventMediaWorker.acquireSession, {
        ...f.args,
        workerId: `replacement-${++sequence}`,
      }),
    );
    assert.ok(replacement.granted);
    assert.ok(replacement.epoch > f.args.epoch);
    assert.deepEqual(replacement.configuration.committedIntent, {
      kind: "manual",
      sourceId: source.id,
      revision: 1,
    });
    assert.equal(replacement.configuration.intentSequence, op.sequence);
    assert.equal(replacement.configuration.sessionDeadline, f.deadline);
    assert.deepEqual(await ack(f, op), { kind: "fenced", reason: "lease" });
    assert.deepEqual(await observe(f, op), { kind: "fenced", reason: "lease" });
    const next = {
      ...f,
      args: {
        ...f.args,
        workerId: `replacement-${sequence}`,
        epoch: replacement.epoch,
      },
    };
    if (mode !== "manual-completed") {
      assert.equal(
        replacement.configuration.pendingOperation?._id,
        op.commandId,
      );
      assert.equal(
        replacement.configuration.pendingOperation?.preparationExpiresAt,
        before.preparationExpiresAt,
      );
      assert.equal(
        (
          await call(() =>
            admin.mutation(api.eventMediaWorker.beginPreparation, {
              ...next.args,
              commandId: op.commandId,
              sequence: op.sequence,
            }),
          )
        ).kind,
        "ok",
      );
      await assert.rejects(
        call(() =>
          owner.mutation(api.events.cancelEventMediaOperation, {
            currentSlug,
            commandId: op.commandId,
            idempotencyKey: `cancel-${++sequence}`,
          }),
        ),
        /preparing/,
      );
      const retained = (await snapshot()).commands.find(
        (c) => c.id === op.commandId,
      );
      assert.ok(retained);
      assert.equal(retained.controlPhase, "promoting");
      assert.equal(retained.preparationExpiresAt, before.preparationExpiresAt);
      assert.deepEqual(retained.controlTarget, before.controlTarget);
      if (mode === "promoting-expired") {
        await scenario("expire-receipt");
        assert.deepEqual(
          await call(() =>
            admin.mutation(api.eventMediaWorker.promoteOperation, {
              ...next.args,
              ...op,
            }),
          ),
          { kind: "failed", reason: "expired" },
        );
        const state = (await snapshot()).sessions.find(
          (s) => s.id === f.args.sessionId,
        );
        assert.deepEqual(state?.committedIntent, {
          kind: "manual",
          sourceId: source.id,
          revision: 1,
        });
      } else {
        assert.equal(
          (
            await call(() =>
              admin.mutation(api.eventMediaWorker.promoteOperation, {
                ...next.args,
                ...op,
              }),
            )
          ).kind,
          "ok",
        );
        const result = await ack(next, op);
        assert.ok("kind" in result);
        assert.equal(result.kind, "ok");
        assert.ok(Date.now() <= before.preparationExpiresAt);
      }
    }
    evidence(mode, {
      passed: true,
      originalExpiry: before.preparationExpiresAt,
      epoch: replacement.epoch,
    });
    await end(f.args.sessionId);
  }
  for (const stopFirst of [false, true]) {
    const f = await start();
    const op = await take(f);
    assert.equal(
      (
        await call(() =>
          admin.mutation(api.eventMediaWorker.promoteOperation, {
            ...f.args,
            ...op,
          }),
        )
      ).kind,
      "ok",
    );
    const cut = () =>
      call(() =>
        owner.mutation(api.events.queueEventMediaCommand, {
          currentSlug,
          type: "switch_hold",
          idempotencyKey: `cut-${++sequence}`,
        }),
      );
    if (!stopFirst) await cut();
    await call(() =>
      owner.mutation(api.events.stopEventMediaWorker, {
        currentSlug,
        sessionId: f.args.sessionId,
      }),
    );
    await assert.rejects(cut(), /stopp/);
    await assert.rejects(
      call(() =>
        owner.mutation(api.events.queueEventMediaCommand, {
          currentSlug,
          type: "switch_source",
          targetSourceKey: "manual-one",
          idempotencyKey: `late-${++sequence}`,
        }),
      ),
      /stopp/,
    );
    await assert.rejects(
      call(() =>
        owner.mutation(api.events.cancelEventMediaOperation, {
          currentSlug,
          commandId: op.commandId,
          idempotencyKey: `cancel-${++sequence}`,
        }),
      ),
      /stopp/,
    );
    assert.deepEqual(await ack(f, op), { kind: "fenced", reason: "stopped" });
    assert.deepEqual(await observe(f, op), {
      kind: "fenced",
      reason: "stopped",
    });
    const claims = await call(() =>
      admin.mutation(api.eventMediaWorker.claimCommands, f.args),
    );
    assert.ok(claims.granted);
    assert.equal(claims.commands[0]?.commandType, "stop_program");
    assert.equal(
      (
        await call(() =>
          admin.mutation(api.eventMediaWorker.acquireSession, f.args),
        )
      ).granted,
      false,
    );
    // Stop permits a bounded grace lease to receive Stop; it is not a control union.
    const renewal = await call(() =>
      admin.mutation(api.eventMediaWorker.renewSession, f.args),
    );
    assert.ok(renewal.granted);
    const config = await call(() =>
      admin.mutation(api.eventMediaWorker.refreshConfiguration, f.args),
    );
    assert.ok(config.granted);
    assert.equal(config.configuration.stopped, true);
    evidence(stopFirst ? "stop-before-cut" : "stop-after-cut", {
      passed: true,
    });
    await call(() =>
      owner.mutation(api.events.markEventMediaWorkerEnded, {
        currentSlug,
        sessionId: f.args.sessionId,
      }),
    );
  }
  for (const revocation of [
    "disable-destination",
    "revoke-destination",
  ] as const)
    for (const promoted of [false, true]) {
      const f = await start();
      const op = await take(f);
      if (promoted)
        assert.equal(
          (
            await call(() =>
              admin.mutation(api.eventMediaWorker.promoteOperation, {
                ...f.args,
                ...op,
              }),
            )
          ).kind,
          "ok",
        );
      await scenario(revocation);
      assert.deepEqual(
        promoted
          ? await ack(f, op)
          : await call(() =>
              admin.mutation(api.eventMediaWorker.promoteOperation, {
                ...f.args,
                ...op,
              }),
            ),
        { kind: "fenced", reason: "destination" },
      );
      assert.deepEqual(await observe(f, op), {
        kind: "fenced",
        reason: "destination",
      });
      if (revocation === "revoke-destination") {
        assert.equal(
          (
            await call(() =>
              admin.mutation(api.eventMediaWorker.renewSession, f.args),
            )
          ).granted,
          false,
        );
        assert.equal(
          (
            await call(() =>
              admin.mutation(api.eventMediaWorker.refreshConfiguration, f.args),
            )
          ).granted,
          false,
        );
        assert.equal(
          (
            await call(() =>
              admin.mutation(api.eventMediaWorker.acquireSession, f.args),
            )
          ).granted,
          false,
        );
      } else {
        const config = await call(() =>
          admin.mutation(api.eventMediaWorker.refreshConfiguration, f.args),
        );
        assert.ok(config.granted);
        assert.equal(config.configuration.outputs.length, 0);
      }
      evidence(`${revocation}-${promoted ? "completion" : "promotion"}`, {
        passed: true,
      });
      await end(f.args.sessionId);
    }
}

async function main() {
  const mode = process.argv[2];
  if (!["seed", "run", "cleanup"].includes(mode ?? ""))
    throw Error("Expected seed, run, or cleanup.");
  const input = validateRehearsalInputs({
    url: process.env.REHEARSAL_CONVEX_URL ?? "",
    runId: process.env.REHEARSAL_RUN_ID ?? "",
    sourceSha: process.env.REHEARSAL_SOURCE_SHA ?? "",
    backendVersion: process.env.CONVEX_LOCAL_BACKEND_VERSION ?? "",
  });
  const adminKey = process.env.REHEARSAL_CONVEX_ADMIN_KEY;
  assert.ok(adminKey);
  const output = process.env.REHEARSAL_RECEIPT_PATH;
  assert.ok(output);
  const fetchBounded: typeof fetch = (url, options) =>
    fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
  const admin = new ConvexHttpClient(input.url, {
    fetch: fetchBounded,
    logger: false,
  });
  // Convex's installed API implements this admin method; guard the runtime boundary.
  function adminAuth(
    client: ConvexHttpClient,
    actor?: FunctionReturnType<Seed>["actor"],
  ) {
    if (
      !("setAdminAuth" in client) ||
      typeof client.setAdminAuth !== "function"
    )
      throw Error("Installed Convex lacks admin auth.");
    client.setAdminAuth(adminKey, actor);
  }
  adminAuth(admin);
  if (mode === "cleanup") {
    const result = await bounded(
      () => admin.mutation(cleanupRef, { runId: input.runId }),
      Date.now() + 30_000,
    );
    await writeFile(
      output,
      JSON.stringify({
        schemaVersion: 1,
        mode,
        sourceSha: input.sourceSha,
        backendVersion: input.backendVersion,
        ...result,
      }) + "\n",
      { mode: 0o600 },
    );
    return;
  }
  if (mode === "seed") {
    const manifest = await bounded(
      () => admin.mutation(seedRef, { runId: input.runId }),
      Date.now() + 10_000,
    );
    await writeFile(
      output,
      JSON.stringify({
        schemaVersion: 1,
        mode,
        sourceSha: input.sourceSha,
        backendVersion: input.backendVersion,
        manifest,
      }) + "\n",
      { mode: 0o600 },
    );
    return;
  }
  const bridgeToken = process.env.REHEARSAL_BRIDGE_TOKEN;
  assert.ok(bridgeToken);
  const owner = new ConvexHttpClient(input.url, {
    fetch: fetchBounded,
    logger: false,
  });
  const subject = `user_rehearsal_${input.runId}`;
  adminAuth(owner, {
    subject,
    issuer: "https://local-rehearsal.invalid",
    tokenIdentifier: `https://local-rehearsal.invalid|${subject}`,
    emailVerified: true,
  });
  const receipt = await runMigrationRehearsal({
    ...input,
    admin,
    owner,
    bridgeToken,
  });
  await writeFile(output, JSON.stringify(receipt, null, 2) + "\n", {
    mode: 0o600,
  });
  process.exitCode = receipt.status === "passed" ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch(() => {
    process.stderr.write(
      "Local rehearsal failed; inspect the bounded receipt and perform owned cleanup.\n",
    );
    process.exitCode = 1;
  });
