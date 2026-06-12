import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  sanitizeEventMediaCommandInput,
  sanitizeVrcdnOperatorOwnedOutputSetup,
  toPublicEventMediaProgramState,
  type EventMediaCommandInput,
  type EventMediaProgramState,
  type EventMediaPublicLink,
  type EventMediaPublicProgramState,
  type SanitizedEventMediaCommand,
} from "../convex/_eventMediaControl";
import { buildMediaControlCustomId, routeMediaInteraction, type DiscordMediaInteractionRoute } from "../apps/discord-gateway/src/mediaControlRouting";

const artifactRoot = resolve("artifacts/restream-control-demo");
const eventId = "event_123";
const currentPanelRevision = 3;
const sourceLabels = new Map([
  ["source_a", "Synthetic Source A"],
  ["source-b", "Synthetic Source B"],
  ["hold", "Hold Slate"],
]);

type DemoStep = {
  label: string;
  route: DiscordMediaInteractionRoute;
  command?: SanitizedEventMediaCommand;
  publicState?: EventMediaPublicProgramState;
};

type ProgramState = {
  status: EventMediaProgramState;
  currentSourceKey?: string;
  currentSourceLabel?: string;
  currentOutputLabel?: string;
  publicLinks: EventMediaPublicLink[];
  directFallbackLinks: EventMediaPublicLink[];
};

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function publicSnapshot(state: ProgramState): EventMediaPublicProgramState {
  return toPublicEventMediaProgramState({
    status: state.status,
    currentSourceLabel: state.currentSourceLabel,
    currentOutputLabel: state.currentOutputLabel,
    publicLinks: state.publicLinks,
    directFallbackLinks: state.directFallbackLinks,
    activeWorkerId: "worker-private-demo",
    workerLeaseExpiresAt: Date.now() + 60_000,
    commandQueueDepth: 1,
    credentialRefs: ["event-media/vrcdn/main-output"],
    privateNotes: "Private demo note that must not appear in public state.",
  });
}

function applyCommand(state: ProgramState, command: EventMediaCommandInput): ProgramState {
  const sanitized = sanitizeEventMediaCommandInput(command);

  switch (sanitized.type) {
    case "start_program":
      return { ...state, status: "live", currentSourceKey: "source_a", currentSourceLabel: sourceLabels.get("source_a") };
    case "switch_hold":
      return { ...state, status: "hold", currentSourceKey: "hold", currentSourceLabel: sourceLabels.get("hold") };
    case "switch_source": {
      assert(sanitized.targetSourceKey !== undefined, "switch_source requires targetSourceKey.");
      assert(sourceLabels.has(sanitized.targetSourceKey), `Unknown source ${sanitized.targetSourceKey}.`);

      return {
        ...state,
        status: "live",
        currentSourceKey: sanitized.targetSourceKey,
        currentSourceLabel: sourceLabels.get(sanitized.targetSourceKey),
      };
    }
    case "stop_program":
      return { ...state, status: "ended" };
    default:
      return state;
  }
}

function customId(action: Parameters<typeof buildMediaControlCustomId>[0]["action"], revision = currentPanelRevision) {
  return buildMediaControlCustomId({ action, eventId, panelRevision: revision });
}

function renderJson(value: unknown) {
  return JSON.stringify(value, null, 2)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function writeHtmlReport(outputDir: string, summary: unknown, steps: DemoStep[]) {
  const rows = steps
    .map(
      (step) => `<tr>
        <td>${step.label}</td>
        <td>${step.route.route}</td>
        <td>${step.route.ack}</td>
        <td>${step.route.requiresConfirmation ? "yes" : "no"}</td>
        <td><pre>${renderJson(step.command ?? step.route.reason ?? "no command")}</pre></td>
        <td><pre>${renderJson(step.publicState ?? "not changed")}</pre></td>
      </tr>`,
    )
    .join("\n");

  writeFileSync(
    join(outputDir, "report.html"),
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VRDex Media Control Demo</title>
  <style>
    body { margin: 0; background: #0b1120; color: #e5e7eb; font-family: Inter, Segoe UI, Arial, sans-serif; }
    main { max-width: 1280px; margin: 0 auto; padding: 32px; }
    h1 { margin: 0 0 8px; }
    .card { background: #111827; border: 1px solid #263244; border-radius: 10px; padding: 16px; margin: 18px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; }
    th, td { border-bottom: 1px solid #263244; padding: 12px; text-align: left; vertical-align: top; }
    th { color: #bfdbfe; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; }
    pre { white-space: pre-wrap; margin: 0; color: #dbeafe; font-size: 12px; }
    code { color: #bfdbfe; }
  </style>
</head>
<body>
  <main>
    <h1>VRDex Media Control Demo</h1>
    <p>Local route-to-command-to-public-state demo. No Discord or Convex mutations were sent.</p>
    <div class="card"><pre>${renderJson(summary)}</pre></div>
    <table>
      <thead>
        <tr><th>Interaction</th><th>Route</th><th>ACK</th><th>Confirm</th><th>Command</th><th>Public State</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
</body>
</html>
`,
  );
}

function main() {
  const output = sanitizeVrcdnOperatorOwnedOutputSetup({
    key: "main_vrcdn",
    label: "Main VRCDN",
    credentialRef: "event-media/vrcdn/main-output",
    ingestRegion: "north_america",
    playbackLinks: [
      { platform: "browser", url: "https://vrcdn.live/vrdex-local-validation" },
      { platform: "pc", url: "https://stream.vrcdn.live/live/vrdex-local-validation.live.ts" },
      { platform: "standalone", url: "rtspt://stream.vrcdn.live/live/vrdex-local-validation" },
    ],
    targetVideoBitrateKbps: 3500,
    keyframeIntervalSeconds: 1,
    audioSampleRateHz: 48000,
    targetAudioBitrateKbps: 320,
    sourceConsentAccepted: true,
    destinationAuthorityAccepted: true,
    providerRulesAccepted: true,
    rightsClearedMediaAccepted: true,
  });
  let state: ProgramState = {
    status: "ready",
    currentOutputLabel: output.label,
    publicLinks: output.playbackLinks,
    directFallbackLinks: output.playbackLinks,
  };
  const interactions = [
    {
      label: "Start button",
      route: routeMediaInteraction({ kind: "button", customId: customId("start"), currentPanelRevision }),
    },
    {
      label: "Hold button",
      route: routeMediaInteraction({ kind: "button", customId: customId("hold"), currentPanelRevision }),
    },
    {
      label: "Source select",
      route: routeMediaInteraction({
        kind: "select",
        customId: customId("source"),
        currentPanelRevision,
        targetSourceKey: "source-b",
      }),
    },
    {
      label: "Stale next button",
      route: routeMediaInteraction({ kind: "button", customId: customId("next", currentPanelRevision - 1), currentPanelRevision }),
    },
    {
      label: "Stop button",
      route: routeMediaInteraction({ kind: "button", customId: customId("stop"), currentPanelRevision }),
    },
  ];
  const steps = interactions.map<DemoStep>((interaction) => {
    const command = interaction.route.command === undefined ? undefined : sanitizeEventMediaCommandInput(interaction.route.command);

    if (command !== undefined) {
      state = applyCommand(state, command);
    }

    return {
      label: interaction.label,
      route: interaction.route,
      ...(command === undefined ? {} : { command, publicState: publicSnapshot(state) }),
    };
  });
  const outputDir = join(artifactRoot, timestamp());
  const summary = {
    generatedAt: new Date().toISOString(),
    output: {
      key: output.key,
      state: output.state,
      compliance: output.compliance,
      publicLinkCount: output.playbackLinks.length,
      hasCredentialReference: output.credential !== undefined,
    },
    eventId,
    currentPanelRevision,
    commandCount: steps.filter((step) => step.command !== undefined).length,
    finalPublicState: publicSnapshot(state),
  };

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "control-demo-summary.json"), `${JSON.stringify({ ...summary, steps }, null, 2)}\n`);
  writeHtmlReport(outputDir, summary, steps);

  console.log(
    JSON.stringify(
      {
        artifact: outputDir,
        report: join(outputDir, "report.html"),
        commandCount: summary.commandCount,
        finalStatus: summary.finalPublicState.status,
      },
      null,
      2,
    ),
  );
}

main();
