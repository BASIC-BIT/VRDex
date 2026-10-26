import type {
  Id,
  TableNames,
} from "../../../../../../convex/_generated/dataModel";
import type { OperatorStatus } from "../../_components/event-operator-view";
import { resolveDestinationProfile } from "../../../../../../workers/restream/broadcast-profiles.mjs";
export type FixtureStatus = Extract<
  OperatorStatus,
  { program: { programId: string } }
>;
/** Fictional IDs are only used inside guarded fixture routes, never submitted. */
export function fixtureId<T extends TableNames>(
  table: T,
  value: string,
): Id<T> {
  if (!/^[a-z0-9-]+$/.test(value) || !table) throw Error("Invalid fixture ID");
  return value as Id<T>;
}
export const fixtureNow = Date.UTC(2026, 9, 19, 22);
export const sessionId = fixtureId("eventMediaSessions", "session");
export function fixtureSource(
  key: string,
  label: string,
  kind: "vrcdn" | "twitch" = "vrcdn",
): FixtureStatus["sources"][number] {
  return {
    sourceId: fixtureId("eventMediaSources", `source-${key}`),
    key,
    position: 0,
    type: kind === "vrcdn" ? "vrcdn_link" : "twitch_watch",
    purpose: "program",
    state: "ready",
    label,
    hasPublicUrl: true,
    hasPrivateConfig: false,
    updatedAt: fixtureNow,
    input: kind === "vrcdn" ? { kind, streamId: key } : { kind, channel: key },
    revision: 1,
    publicUrl:
      kind === "vrcdn"
        ? `https://stream.vrcdn.live/live/${key}.live.ts`
        : `https://www.twitch.tv/${key}`,
    editable: true,
  };
}
export function fixtureCommand(
  type: FixtureStatus["commands"][number]["commandType"],
  status: FixtureStatus["commands"][number]["status"] = "queued",
): FixtureStatus["commands"][number] {
  return {
    sessionId,
    sequence: 1,
    controlTarget: undefined,
    controlPhase: undefined,
    preparationExpiresAt: undefined,
    controlOutcome: undefined,
    controlFailure: undefined,
    acknowledgedEpoch: undefined,
    commandId: fixtureId("eventMediaCommands", "command"),
    commandType: type,
    status,
    actorSurface: "web",
    fallbackLinkCount: 0,
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
  };
}
export function operatorFixture(): FixtureStatus {
  const primary = fixtureId("eventMediaOutputs", "primary"),
    optional = fixtureId("eventMediaOutputs", "optional");
  const settings = { videoPreset: "720p30", audioBitrateKbps: 160 } as const;
  const formats = [
    {
      outputId: primary,
      destination: "vrcdn",
      profile: resolveDestinationProfile({ settings, destination: "vrcdn" }),
    },
    {
      outputId: optional,
      destination: "twitch",
      profile: resolveDestinationProfile({ settings, destination: "twitch" }),
    },
  ] satisfies FixtureStatus["sessions"][number]["destinationProfiles"];
  return {
    twitchAccounts: [{ key: "organizer-twitch", channel: "afterglow" }],
    eventTitle: "Afterglow Harbor Sessions",
    serverNow: fixtureNow,
    canControl: true,
    outputConfigurationLocked: true,
    eventId: fixtureId("events", "event"),
    eventPath: "/playwright-afterglow-social/events/playwright-event-host-view",
    program: {
      programId: fixtureId("eventMediaPrograms", "program"),
      state: "hold",
      activeSessionId: sessionId,
      publicLinkCount: 1,
      directFallbackLinkCount: 1,
      updatedAt: 1,
      broadcastPolicy: undefined,
      mediaSettings: settings,
      currentSourceId: undefined,
    },
    sources: [
      {
        ...fixtureSource("aurora", "Aurora"),
        editable: false,
        eventSlotId: fixtureId("eventSlots", "slot-a"),
      },
      {
        ...fixtureSource("nova", "Nova", "twitch"),
        hasPublicUrl: false,
        editable: false,
        sourceProfileId: fixtureId("profiles", "nova"),
      },
      fixtureSource("custom", "Custom", "twitch"),
    ],
    outputs: [
      {
        outputId: primary,
        key: "primary",
        type: "vrcdn",
        state: "ready",
        label: "VRCDN",
        hasCredential: true,
        authorized: true,
        twitchSetup: undefined,
        simulcastEnabled: false,
        playbackLinkCount: 1,
        updatedAt: 1,
      },
      {
        outputId: optional,
        key: "twitch",
        type: "external_rtmp",
        state: "ready",
        label: "Twitch",
        hasCredential: true,
        authorized: true,
        twitchSetup: undefined,
        simulcastEnabled: true,
        playbackLinkCount: 0,
        updatedAt: 1,
      },
    ],
    sessions: [
      {
        sessionId,
        status: "hold",
        broadcastMode: "hold",
        epoch: 2,
        lastAcknowledgedSequence: 3,
        leaseExpiresAt: fixtureNow + 30_000,
        runtimeDeadlineAt: fixtureNow + 3_600_000,
        artifactLinks: [],
        programObservedAt: fixtureNow,
        outputHealthObservedAt: fixtureNow,
        updatedAt: 1,
        committedIntent: { kind: "slate" },
        intentSequence: 0,
        pendingControlCommandId: undefined,
        mediaSettings: settings,
        controlProtocolVersion: 2,
        destinationProfiles: formats,
        allocation: undefined,
        currentSourceId: undefined,
        observedSourceRevision: undefined,
        observedSlotKey: undefined,
        observedOutputMs: 1500,
        launchProtocol: undefined,
        launchAttemptedAt: undefined,
        dispatchId: undefined,
        dispatchStopConfirmedAt: undefined,
        workerTaskCleanupPending: undefined,
        pendingOperation: null,
        resources: {
          allocation: undefined,
          provider: "aws_ecs",
          region: "us-east-1",
          activeFormats: formats,
          computeRuntime: undefined,
          computeEstimate: undefined,
          observedAt: fixtureNow,
          sampleAgeMs: 0,
          sampleSequence: 1,
          windowMs: 10000,
          staleAfterMs: 30000,
          fresh: true,
          cpuUsagePercent: 0,
          memoryUsedBytes: 1048576,
        },
        outputHealth: [
          {
            outputId: primary,
            destination: "vrcdn",
            status: "publishing",
            publishing: true,
            queueBytes: 0,
            outputMs: 1500,
            restarts: 0,
          },
          {
            outputId: optional,
            destination: "twitch",
            status: "reconnecting",
            publishing: false,
            queueBytes: 0,
            outputMs: 0,
            restarts: 2,
          },
        ],
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
  };
}
