"use client";
import { useState } from "react";
import {
  EventOperatorControls,
  type OperatorStatus,
} from "../../_components/event-operator-view";
// Test-only records, matching the existing editor fixture boundary.
type FixtureStatus = Extract<
  OperatorStatus,
  { program: { programId: string } }
>;
const fixtureNow = Date.UTC(2026, 9, 19, 22);
const initial = {
  twitchAccounts: [{ key: "organizer-twitch", channel: "afterglow" }],
  eventTitle: "Afterglow Harbor Sessions",
  serverNow: fixtureNow,
  canControl: true,
  outputConfigurationLocked: true,
  eventId: "event",
  eventPath: "/playwright-afterglow-social/events/playwright-event-host-view",
  program: {
    programId: "program",
    state: "hold",
    activeSessionId: "session",
    publicLinkCount: 1,
    directFallbackLinkCount: 1,
    updatedAt: 1,
  },
  sources: [
    {
      sourceId: "source-a",
      key: "a",
      position: 0,
      type: "vrcdn_link",
      purpose: "program",
      state: "ready",
      label: "Aurora",
      hasPublicUrl: true,
      hasPrivateConfig: false,
      updatedAt: 1,
    },
    {
      sourceId: "source-b",
      key: "b",
      position: 1,
      type: "vrcdn_link",
      purpose: "program",
      state: "ready",
      label: "Nova",
      hasPublicUrl: false,
      hasPrivateConfig: false,
      updatedAt: 1,
    },
  ],
  outputs: [
    {
      outputId: "primary",
      key: "primary",
      type: "vrcdn",
      state: "ready",
      label: "VRCDN",
      hasCredential: true,
      simulcastEnabled: false,
      playbackLinkCount: 1,
      updatedAt: 1,
    },
    {
      outputId: "optional",
      key: "twitch",
      type: "external_rtmp",
      state: "ready",
      label: "Twitch",
      hasCredential: true,
      simulcastEnabled: true,
      playbackLinkCount: 0,
      updatedAt: 1,
    },
  ],
  sessions: [
    {
      sessionId: "session",
      status: "hold",
      broadcastMode: "hold",
      epoch: 2,
      lastAcknowledgedSequence: 3,
      leaseExpiresAt: fixtureNow + 30000,
      runtimeDeadlineAt: fixtureNow + 3600000,
      artifactLinks: [],
      programObservedAt: fixtureNow,
      outputHealthObservedAt: fixtureNow,
      outputHealth: [
        {
          outputId: "primary",
          destination: "vrcdn",
          status: "publishing",
          publishing: true,
          queueBytes: 0,
          outputMs: 1500,
          restarts: 0,
        },
        {
          outputId: "optional",
          destination: "twitch",
          status: "reconnecting",
          publishing: false,
          queueBytes: 0,
          outputMs: 0,
          restarts: 2,
        },
      ],
      updatedAt: 1,
    },
  ],
  commands: [],
  queuedCommandCount: 0,
  operationReadiness: {
    hasMediaProgram: true,
    readyOutputCount: 2,
    activeOutputCount: 0,
    sourceStates: {},
    commandStates: {},
    openSessionCount: 1,
  },
} as unknown as FixtureStatus;
export function EventOperatorFixture() {
  const [status, setStatus] = useState(initial);
  const [count, setCount] = useState(0);
  const [holdRequest, setHoldRequest] = useState(false);
  const [fail, setFail] = useState(false);
  async function command(type: string, key?: string) {
    setCount((value) => value + 1);
    if (fail) throw new Error("fixture failure");
    if (holdRequest) await new Promise<void>(() => {});
    const row = {
      sessionId: "session",
      commandId: "command",
      commandType: type,
      status: "queued",
      actorSurface: "web",
      fallbackLinkCount: 0,
      targetSourceId: key === "a" ? "source-a" : undefined,
      createdAt: fixtureNow,
      updatedAt: fixtureNow,
    } as unknown as OperatorStatus["commands"][number];
    setStatus((value) => ({ ...value, commands: [row] }));
    setTimeout(
      () =>
        setStatus((value) => ({
          ...value,
          serverNow: value.serverNow + 1000,
          commands: [{ ...row, status: "succeeded" }],
          sessions: value.sessions.map((session) => ({
            ...session,
            currentSourceId:
              key === "a" ? value.sources[0].sourceId : session.currentSourceId,
            broadcastMode:
              type === "set_automatic_mode"
                ? "automatic"
                : type === "switch_hold"
                  ? "hold"
                  : "manual",
            status: type === "switch_hold" ? "hold" : "live",
            lastAcknowledgedSequence: 4,
            programObservedAt: value.serverNow + 1000,
            outputHealthObservedAt: value.serverNow + 1000,
            leaseExpiresAt: value.serverNow + 31000,
          })),
        })),
      800,
    );
  }
  return (
    <>
      <EventOperatorControls
        status={status}
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
        onStart={async () => {
          setCount((value) => value + 1);
          setStatus((value) => ({
            ...value,
            sessions: value.sessions.map((session) => ({
              ...session,
              status: "starting",
              programObservedAt: undefined,
              currentSourceId: undefined,
              outputHealth: [],
            })),
          }));
        }}
        onStop={async () => {
          setCount((value) => value + 1);
          setStatus((value) => ({
            ...value,
            sessions: value.sessions.map((session) => ({
              ...session,
              status: "stopping",
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
        <button
          onClick={() =>
            setStatus((value) => ({
              ...value,
              sessions: value.sessions.map((session) => ({
                ...session,
                status: "live",
                broadcastMode: "automatic",
                currentSourceId: value.sources[0].sourceId,
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
