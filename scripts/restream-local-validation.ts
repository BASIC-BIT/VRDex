import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  sanitizeEventMediaCommandInput,
  sanitizeVrcdnOperatorOwnedOutputSetup,
  toPublicEventMediaProgramState,
  type EventMediaCommandInput,
  type EventMediaOutputCompliance,
  type EventMediaProgramState,
  type EventMediaPublicLink,
  type EventMediaPublicProgramState,
  type SanitizedEventMediaCommand,
} from "../convex/_eventMediaControl";

const validationArtifactRoot = resolve("artifacts/restream-local-validation");
const ffmpegArtifactRoot = resolve("artifacts/restream-ffmpeg-proof");

type LocalMediaCommandRecord = {
  id: string;
  atSeconds: number;
  status: "queued" | "claimed" | "succeeded";
  command: SanitizedEventMediaCommand;
};

type LocalProgramState = {
  status: EventMediaProgramState;
  currentSourceKey?: string;
  currentSourceLabel?: string;
  currentOutputLabel?: string;
  publicLinks: EventMediaPublicLink[];
  directFallbackLinks: EventMediaPublicLink[];
};

type LocalValidationSummary = {
  generatedAt: string;
  proofArtifact: string;
  output: {
    key: string;
    type: "vrcdn";
    state: "draft" | "ready";
    hasCredentialReference: boolean;
    compliance: EventMediaOutputCompliance;
  };
  commands: Array<{
    id: string;
    atSeconds: number;
    type: SanitizedEventMediaCommand["type"];
    status: LocalMediaCommandRecord["status"];
    targetSourceKey?: string;
  }>;
  publicSnapshots: Array<{
    afterCommand: SanitizedEventMediaCommand["type"];
    state: EventMediaPublicProgramState;
  }>;
};

const sourceLabels = new Map([
  ["source_a", "Synthetic Source A"],
  ["source-b", "Synthetic Source B"],
  ["hold", "Hold Slate"],
]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`${command} exited with ${code}`));
    });
  });
}

function latestArtifactDir(root: string) {
  assert(existsSync(root), `No artifact root exists at ${root}.`);

  const entries = readdirSync(root)
    .map((entry) => join(root, entry))
    .filter((entry) => statSync(entry).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

  assert(entries.length > 0, `No artifacts exist under ${root}.`);

  return entries[0];
}

function commandRecord(id: string, atSeconds: number, input: EventMediaCommandInput): LocalMediaCommandRecord {
  return {
    id,
    atSeconds,
    status: "queued",
    command: sanitizeEventMediaCommandInput(input),
  };
}

function buildFixture() {
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

  const commands = [
    commandRecord("cmd_start", 0, { type: "start_program" }),
    commandRecord("cmd_hold", 4, { type: "switch_hold" }),
    commandRecord("cmd_source_b", 8, { type: "switch_source", targetSourceKey: "source-b" }),
    commandRecord("cmd_stop", 12, { type: "stop_program" }),
  ];

  return { output, commands };
}

function applyCommand(state: LocalProgramState, record: LocalMediaCommandRecord): LocalProgramState {
  record.status = "claimed";

  switch (record.command.type) {
    case "start_program":
      record.status = "succeeded";
      return {
        ...state,
        status: "live",
        currentSourceKey: "source_a",
        currentSourceLabel: sourceLabels.get("source_a"),
      };
    case "switch_hold":
      record.status = "succeeded";
      return {
        ...state,
        status: "hold",
        currentSourceKey: "hold",
        currentSourceLabel: sourceLabels.get("hold"),
      };
    case "switch_source": {
      const targetSourceKey = record.command.targetSourceKey;

      assert(targetSourceKey !== undefined, "switch_source command should have a target source key.");
      assert(sourceLabels.has(targetSourceKey), `Unknown local source ${targetSourceKey}.`);

      record.status = "succeeded";
      return {
        ...state,
        status: "live",
        currentSourceKey: targetSourceKey,
        currentSourceLabel: sourceLabels.get(targetSourceKey),
      };
    }
    case "stop_program":
      record.status = "succeeded";
      return { ...state, status: "ended" };
    default:
      throw new Error(`Unsupported local validation command ${record.command.type}.`);
  }
}

function publicSnapshot(state: LocalProgramState): EventMediaPublicProgramState {
  const publicState = toPublicEventMediaProgramState({
    status: state.status,
    currentSourceLabel: state.currentSourceLabel,
    currentOutputLabel: state.currentOutputLabel,
    publicLinks: state.publicLinks,
    directFallbackLinks: state.directFallbackLinks,
    activeWorkerId: "local-worker-private",
    commandQueueDepth: 1,
    credentialRefs: ["event-media/vrcdn/main-output"],
    privateNotes: "This must not appear in public snapshots.",
  });

  assertSafePublicState(publicState);

  return publicState;
}

function assertSafePublicState(state: EventMediaPublicProgramState) {
  const raw = state as Record<string, unknown>;

  for (const privateField of ["activeWorkerId", "commandQueueDepth", "credentialRefs", "privateNotes"]) {
    assert(!(privateField in raw), `Public media state leaked ${privateField}.`);
  }
}

function runCommandLoop(): Omit<LocalValidationSummary, "generatedAt" | "proofArtifact"> {
  const { output, commands } = buildFixture();
  assert(output.state === "ready", "Local output fixture should be ready before worker command validation.");

  let state: LocalProgramState = {
    status: "ready",
    currentOutputLabel: output.label,
    publicLinks: output.playbackLinks,
    directFallbackLinks: output.playbackLinks,
  };
  const publicSnapshots: LocalValidationSummary["publicSnapshots"] = [];

  for (const record of commands) {
    state = applyCommand(state, record);
    publicSnapshots.push({ afterCommand: record.command.type, state: publicSnapshot(state) });
  }

  assert(commands.every((command) => command.status === "succeeded"), "All local media commands should succeed.");
  assert(publicSnapshots.at(-1)?.state.status === "ended", "Final public snapshot should show the program ended.");

  return {
    output: {
      key: output.key,
      type: output.type,
      state: output.state,
      hasCredentialReference: output.credential !== undefined,
      compliance: output.compliance,
    },
    commands: commands.map((record) => ({
      id: record.id,
      atSeconds: record.atSeconds,
      type: record.command.type,
      status: record.status,
      ...(record.command.targetSourceKey === undefined ? {} : { targetSourceKey: record.command.targetSourceKey }),
    })),
    publicSnapshots,
  };
}

function assertProofMatchesCommands(proofArtifact: string, commands: LocalValidationSummary["commands"]) {
  const timelinePath = join(proofArtifact, "command-timeline.json");
  assert(existsSync(timelinePath), `Missing FFmpeg proof command timeline at ${timelinePath}.`);

  const proofTimeline = JSON.parse(readFileSync(timelinePath, "utf8")) as Array<{
    atSeconds: number;
    command: SanitizedEventMediaCommand["type"];
    targetSourceKey?: string;
  }>;

  assert(proofTimeline.length === commands.length, "FFmpeg proof timeline should match local command count.");

  for (const [index, proofCommand] of proofTimeline.entries()) {
    const command = commands[index];

    assert(command !== undefined, `Missing local command at index ${index}.`);
    assert(proofCommand.atSeconds === command.atSeconds, `Timeline seconds mismatch at command ${command.id}.`);
    assert(proofCommand.command === command.type, `Timeline command mismatch at command ${command.id}.`);
    assert(proofCommand.targetSourceKey === command.targetSourceKey, `Timeline target mismatch at command ${command.id}.`);
  }
}

async function runValidation() {
  await run(process.execPath, ["scripts/restream-ffmpeg-proof.mjs", "run"]);

  const proofArtifact = latestArtifactDir(ffmpegArtifactRoot);
  const summary = {
    generatedAt: new Date().toISOString(),
    proofArtifact,
    ...runCommandLoop(),
  } satisfies LocalValidationSummary;

  assertProofMatchesCommands(proofArtifact, summary.commands);

  const outputDir = join(validationArtifactRoot, timestamp());
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "validation-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

  await checkValidation(outputDir);
  console.log(`Restream local validation artifacts: ${outputDir}`);
}

async function checkValidation(inputDir = process.argv[3] ? resolve(process.argv[3]) : latestArtifactDir(validationArtifactRoot)) {
  const summaryPath = join(resolve(inputDir), "validation-summary.json");
  assert(existsSync(summaryPath), `Missing validation summary at ${summaryPath}.`);

  const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as LocalValidationSummary;

  assert(summary.output.state === "ready", "Local output should be ready.");
  assert(summary.output.hasCredentialReference, "Local output should use a credential reference.");
  assert(summary.commands.every((command) => command.status === "succeeded"), "All local commands should be succeeded.");
  assert(summary.publicSnapshots.length === summary.commands.length, "Every command should produce a public snapshot.");

  for (const snapshot of summary.publicSnapshots) {
    assertSafePublicState(snapshot.state);
  }

  assertProofMatchesCommands(summary.proofArtifact, summary.commands);
  await run(process.execPath, ["scripts/restream-ffmpeg-proof.mjs", "check", summary.proofArtifact]);

  console.log(
    JSON.stringify(
      {
        artifact: resolve(inputDir),
        proofArtifact: summary.proofArtifact,
        commandCount: summary.commands.length,
        finalStatus: summary.publicSnapshots.at(-1)?.state.status,
      },
      null,
      2,
    ),
  );
}

const mode = process.argv[2] ?? "run";

async function main() {
  if (mode === "run") {
    await runValidation();
  } else if (mode === "check") {
    await checkValidation();
  } else {
    throw new Error(`Unknown mode ${mode}. Use run or check.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
