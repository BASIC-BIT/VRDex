"use client";
import { useRef, useState } from "react";
import {
  EventOperatorControls,
  type OperatorStatus,
} from "../../_components/event-operator-view";
import {
  operatorFixture,
  fixtureCommand,
  fixtureSource,
  fixtureId,
  fixtureNow,
  type FixtureStatus,
} from "./fixture-state";
import {
  parseBroadcastInputUrl,
  broadcastInputPublicUrl,
} from "../../../../../../convex/_eventBroadcastSources";
const initial = operatorFixture();
export function EventOperatorFixture() {
  const [status, setStatus] = useState<FixtureStatus>(initial);
  const [count, setCount] = useState(0);
  const [startedOutput, setStartedOutput] = useState("");
  const [holdRequest, setHoldRequest] = useState(false);
  const [fail, setFail] = useState(false);
  const [holdPreparation, setHoldPreparation] = useState(false);
  const sequence = useRef(0);
  async function command(
    type: OperatorStatus["commands"][number]["commandType"],
    key?: string,
  ) {
    setCount((value) => value + 1);
    if (fail) throw Error("fixture failure");
    if (holdRequest && type !== "switch_hold")
      await new Promise<void>(() => {});
    const attempt = ++sequence.current;
    const target =
      status.sources.find((source) => source.key === key) ?? status.sources[0];
    const preparing = type === "switch_source" || type === "switch_next";
    const row = {
      ...fixtureCommand(type, "claimed"),
      sequence: attempt,
      commandId: fixtureId("eventMediaCommands", `command-${attempt}`),
      targetSourceId: preparing ? target.sourceId : undefined,
    };
    setStatus((value) => ({
      ...value,
      commands: [
        row,
        ...value.commands.map((command) =>
          command.status === "queued" || command.status === "claimed"
            ? {
                ...command,
                status: "cancelled" as const,
                controlOutcome: "superseded" as const,
              }
            : command,
        ),
      ],
      sessions: value.sessions.map((session) => ({
        ...session,
        pendingOperation: preparing
          ? {
              commandId: row.commandId,
              sequence: attempt,
              phase: "preparing",
              preparationExpiresAt: fixtureNow + 15_000,
              target: {
                kind: "source",
                source: {
                  sourceId: target.sourceId,
                  revision: target.revision,
                  slotKey: target.key,
                },
                mode: "manual",
              },
            }
          : null,
      })),
    }));
    if (holdPreparation && preparing) return;
    setTimeout(() => {
      if (sequence.current !== attempt) return;
      setStatus((value) => ({
        ...value,
        serverNow: value.serverNow + 1000,
        commands: [
          { ...row, status: "succeeded", controlOutcome: "ok" },
          ...value.commands.filter(
            (command) => command.commandId !== row.commandId,
          ),
        ],
        sessions: value.sessions.map((session) => {
          const slate = type === "switch_hold" || type === "set_automatic_mode";
          return {
            ...session,
            pendingOperation: null,
            currentSourceId: slate ? undefined : target.sourceId,
            observedSourceRevision: slate ? undefined : target.revision,
            observedSlotKey: slate ? undefined : target.key,
            observedOutputMs: 2000,
            committedIntent:
              type === "set_automatic_mode"
                ? { kind: "automatic" }
                : slate
                  ? { kind: "slate" }
                  : {
                      kind: "manual",
                      sourceId: target.sourceId,
                      revision: target.revision,
                    },
            broadcastMode:
              type === "set_automatic_mode"
                ? "automatic"
                : slate
                  ? "hold"
                  : "manual",
            status: slate ? "hold" : "live",
            lastAcknowledgedSequence: attempt,
            programObservedAt: value.serverNow + 1000,
            outputHealthObservedAt: value.serverNow + 1000,
            leaseExpiresAt: value.serverNow + 31000,
          };
        }),
      }));
    }, 800);
  }
  return (
    <>
      <EventOperatorControls
        status={status}
        onCancel={async () => {
          sequence.current++;
          setCount((value) => value + 1);
          setStatus((value) => ({
            ...value,
            commands: value.commands.map((command) => ({
              ...command,
              status: "cancelled",
              controlOutcome: "cancelled",
            })),
            sessions: value.sessions.map((session) => ({
              ...session,
              pendingOperation: null,
            })),
          }));
        }}
        onCreate={async (input) => {
          const canonical = parseBroadcastInputUrl(input.url);
          const source = {
            ...fixtureSource(
              `custom${status.sources.length}`,
              input.label,
              canonical.kind,
            ),
            input: canonical,
            publicUrl: broadcastInputPublicUrl(canonical),
          };
          setStatus((value) => ({
            ...value,
            sources: [...value.sources, source],
          }));
        }}
        onReplace={async (source, input) => {
          const canonical = parseBroadcastInputUrl(input.url);
          const replacement = {
            ...fixtureSource(
              `replacement${status.sources.length}`,
              input.label,
              canonical.kind,
            ),
            input: canonical,
            publicUrl: broadcastInputPublicUrl(canonical),
            revision: source.revision + 1,
          };
          setStatus((value) => ({
            ...value,
            sources: [...value.sources, replacement],
          }));
        }}
        onRemove={async (source) => {
          sequence.current++;
          setStatus((value) => ({
            ...value,
            sources: value.sources.filter(
              (row) => row.sourceId !== source.sourceId,
            ),
            sessions: value.sessions.map((session) =>
              session.currentSourceId === source.sourceId
                ? {
                    ...session,
                    committedIntent: { kind: "slate" },
                    pendingOperation: null,
                  }
                : session,
            ),
          }));
        }}
        onSaveSettings={async (mediaSettings) =>
          setStatus((value) => ({
            ...value,
            program: { ...value.program, mediaSettings },
          }))
        }
        title="Afterglow Harbor Sessions"
        onTwitch={async (input) => {
          setCount((value) => value + 1);
          setStatus((value) => ({
            ...value,
            outputs: value.outputs.map((output) =>
              output.key === "twitch"
                ? { ...output, simulcastEnabled: input.simulcastEnabled }
                : output,
            ),
          }));
        }}
        onCommand={command}
        onStart={async (outputKey) => {
          setStartedOutput(outputKey);
          setCount((value) => value + 1);
          setStatus((value) => ({
            ...value,
            sessions: value.sessions.map((session) => ({
              ...session,
              status: "starting",
              programObservedAt: undefined,
              currentSourceId: undefined,
              observedSourceRevision: undefined,
              observedSlotKey: undefined,
              observedOutputMs: undefined,
              outputHealth: [],
            })),
          }));
        }}
        onStop={async () => {
          sequence.current++;
          setCount((value) => value + 1);
          setStatus((value) => ({
            ...value,
            sessions: value.sessions.map((session) => ({
              ...session,
              status: "stopping",
              pendingOperation: null,
            })),
          }));
        }}
        onPolicy={async (maxOverrunMs) => {
          setCount((value) => value + 1);
          setStatus((value) => ({
            ...value,
            program: { ...value.program, broadcastPolicy: { maxOverrunMs } },
          }));
        }}
      />
      <aside className="px-8">
        <button onClick={() => setHoldPreparation(true)}>
          Hold preparation
        </button>
        <button
          onClick={() => {
            sequence.current++;
            setStatus((value) => ({
              ...value,
              commands: value.commands.map((command) => ({
                ...command,
                status: "failed",
                controlOutcome: "failed",
                controlFailure: "source_unavailable",
              })),
              sessions: value.sessions.map((session) => ({
                ...session,
                pendingOperation: null,
              })),
            }));
          }}
        >
          Fail preparation
        </button>
        <button
          onClick={() =>
            setStatus((value) => ({
              ...value,
              sessions: value.sessions.map((session) => ({
                ...session,
                pendingOperation: session.pendingOperation
                  ? { ...session.pendingOperation, phase: "promoting" }
                  : null,
              })),
            }))
          }
        >
          Promote preparation
        </button>
        <button
          onClick={() =>
            setStatus((value) => ({
              ...value,
              sessions: value.sessions.map((session) => ({
                ...session,
                epoch: (session.epoch ?? 0) + 1,
                programObservedAt: undefined,
                observedSourceRevision: undefined,
                observedSlotKey: undefined,
                observedOutputMs: undefined,
                resources: {
                  ...session.resources,
                  fresh: false,
                  cpuUsagePercent: undefined,
                  memoryUsedBytes: undefined,
                  observedAt: undefined,
                },
              })),
            }))
          }
        >
          New epoch
        </button>
        <button
          onClick={() =>
            setStatus((value) => ({
              ...value,
              sessions: [],
              outputConfigurationLocked: false,
              program: { ...value.program, activeSessionId: undefined },
              commands: [
                { ...fixtureCommand("switch_hold"), sessionId: undefined },
              ],
            }))
          }
        >
          Queue before session
        </button>
        <output aria-label="Started output">{startedOutput}</output>
        <button
          onClick={() =>
            setStatus((value) => ({
              ...value,
              sessions: value.sessions.map((session) => ({
                ...session,
                status: "live",
                broadcastMode: "automatic",
                currentSourceId: value.sources[0].sourceId,
                observedSourceRevision: value.sources[0].revision,
                observedSlotKey: value.sources[0].key,
                observedOutputMs: 1500,
                programObservedAt: fixtureNow,
              })),
            }))
          }
        >
          Observe live
        </button>
        <button
          onClick={() =>
            setStatus((value) => ({
              ...value,
              sessions: value.sessions.map((session) => ({
                ...session,
                leaseExpiresAt: fixtureNow - 1,
              })),
            }))
          }
        >
          Expire lease
        </button>
        <button
          onClick={() =>
            setStatus((value) => ({
              ...value,
              serverNow: fixtureNow + 1,
              sessions: value.sessions.map((session) => ({
                ...session,
                programObservedAt: fixtureNow - 16000,
                updatedAt: fixtureNow + 1,
              })),
            }))
          }
        >
          Stale observation
        </button>

        <button onClick={() => setHoldRequest(true)}>Hold request</button>
        <button
          onClick={() =>
            setStatus((value) => ({
              ...value,
              outputConfigurationLocked: false,
              sessions: value.sessions.map((session) => ({
                ...session,
                status: "ended",
              })),
            }))
          }
        >
          End session
        </button>
        <button
          onClick={() =>
            setStatus((value) => ({
              ...value,
              commands: [fixtureCommand("start_program", "claimed")],
            }))
          }
        >
          Claim startup
        </button>
        <button
          onClick={() =>
            setStatus((value) => ({
              ...value,
              commands: value.commands.map((command) => ({
                ...command,
                status: "failed",
              })),
            }))
          }
        >
          Settle commands
        </button>
        <button
          onClick={() =>
            setStatus((value) => ({
              ...value,
              outputConfigurationLocked: false,
            }))
          }
        >
          Confirm task stopped
        </button>
        <output aria-label="Command count">{count}</output>
        <button onClick={() => setFail(true)}>Fail commands</button>
        <button
          onClick={() =>
            setStatus((value) => ({ ...value, canControl: false }))
          }
        >
          Revoke capability
        </button>
        <button
          onClick={() =>
            setStatus((value) => ({
              ...value,
              sessions: value.sessions.map((session) => ({
                ...session,
                status: "error",
              })),
            }))
          }
        >
          Fail worker
        </button>
      </aside>
    </>
  );
}
