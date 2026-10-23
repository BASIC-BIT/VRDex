import { runPublicInputWorkload } from "./event-public-input-proof.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { createTwitchInput } from "../workers/restream/twitch-input.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createProcessOwner } from "./event-proof-processes.mjs";
import { runProofEnvelope } from "./event-proof-envelope.mjs";
export const TRANSPORT_CASES = Object.freeze({
  public: [],
  tls: ["test_twitch_transport"],
  hls: ["test_twitch_input.SyntheticHLSContracts"],
  cold: [
    "test_twitch_input.SyntheticHLSContracts.test_three_second_cold_then_warmup_before_normalized_ready",
  ],
  jitter: [
    "test_twitch_input.SyntheticHLSContracts.test_delivery_jitter_keeps_normalized_packet_progress",
  ],
  ads: [
    "test_twitch_input.AdvertisementDeadlineContracts",
    "test_twitch_input.AdvertisementTimelineContracts",
  ],
  expiry: [
    "test_twitch_input.SyntheticHLSContracts.test_403_discards_locator_and_next_resolution_is_fresh",
  ],
  deadline: ["test_twitch_input.OuterDeadlineContracts"],
  all: ["test_twitch_transport", "test_twitch_input"],
});
export function parseTwitchArguments(args) {
  if (
    args.length !== 4 ||
    args[0] !== "--case" ||
    args[2] !== "--output-dir" ||
    !Object.hasOwn(TRANSPORT_CASES, args[1]) ||
    !/^\/tmp\/event-capacity-[a-zA-Z0-9_-]{1,80}$/.test(args[3])
  )
    throw Error("Invalid Twitch proof arguments");
  return { case: args[1], outputDir: args[3] };
}
export function parseNamedSummary(bytes, expectedCount) {
  if (bytes.length > 131072) throw Error("Oversized named summary");
  let value;
  try {
    value = JSON.parse(bytes.toString());
  } catch {
    throw Error("Invalid named summary");
  }
  if (
    !value ||
    Object.keys(value).some(
      (key) => !["testsRun", "outcomes", "passed"].includes(key),
    ) ||
    !Number.isInteger(value.testsRun) ||
    value.testsRun < 1 ||
    value.testsRun > 256 ||
    !Array.isArray(value.outcomes) ||
    value.outcomes.length !== value.testsRun ||
    typeof value.passed !== "boolean" ||
    value.outcomes.some(
      (row) =>
        !row ||
        typeof row.test !== "string" ||
        row.test.length > 200 ||
        !/^[A-Za-z0-9_.,' /\-]+$/.test(row.test) ||
        ![
          "passed",
          "failed",
          "error",
          "skipped",
          "expected_failure",
          "unexpected_success",
          "todo",
        ].includes(row.outcome) ||
        Object.keys(row).some(
          (k) => !["test", "outcome", "type"].includes(k),
        ) ||
        (row.type !== undefined &&
          (typeof row.type !== "string" ||
            !/^[A-Za-z0-9_]{1,80}$/.test(row.type))),
    )
  )
    throw Error("Invalid named summary");
  value.passed =
    value.passed &&
    value.outcomes.every((row) => row.outcome === "passed") &&
    (expectedCount === undefined || value.testsRun === expectedCount);
  return value;
}
export function transportContractFailurePhase(tests) {
  if (tests?.passed !== true) return "python_contracts";
  if (tests.owner?.passed !== true) return "owner_contracts";
  return undefined;
}
export async function runTransportWorkload(request) {
  const owner = createProcessOwner();
  let passed = false,
    cleanup,
    tests,
    phase = "python_contracts",
    failurePhase;
  await mkdir(request.outputDir, { recursive: false });
  try {
    tests = parseNamedSummary(
      (
        await owner.run(
          "python3",
          [
            "-m",
            "workers.restream.tests.proof_suite",
            ...TRANSPORT_CASES[request.case],
          ],
          { timeoutMs: 240000, maxBytes: 262144 },
        )
      ).toString(),
      request.case === "all" ? 42 : undefined,
    );
    phase = "owner_contracts";
    tests.owner = parseNamedSummary(
      await owner.run(
        process.execPath,
        ["workers/restream/tests/owner_proof.mjs"],
        { timeoutMs: 120000, maxBytes: 131072 },
      ),
      89,
    );
    const contractFailure = transportContractFailurePhase(tests);
    if (contractFailure) {
      phase = contractFailure;
      throw Error("Named transport contracts failed");
    }
    phase = "blocked_resolution_cancellation";
    // Cancellation during blocked resolution must close the real wrapper's group.
    const input = createTwitchInput({
      source: { kind: "twitch", channel: "fixture" },
      settings: { videoPreset: "720p30", audioBitrateKbps: 320 },
      spawnProcess: (_cmd, _args, options) =>
        owner.start("python3", ["-c", "import time; time.sleep(60)"], options),
    });
    await sleep(100);
    const began = performance.now();
    await input.dispose();
    tests.cancellationMs = performance.now() - began;
    if (tests.cancellationMs > 1500) throw Error("Cancellation exceeded bound");
    passed = true;
  } catch {
    failurePhase = phase;
  } finally {
    try {
      cleanup = await owner.close();
    } catch {
      cleanup = { closed: false };
      passed = false;
      failurePhase ??= "cleanup";
    }
    await writeFile(
      `${request.outputDir}/receipt.json`,
      JSON.stringify(
        {
          schemaVersion: 1,
          terminal: true,
          passed,
          cleanup,
          case: request.case,
          tests,
          ...(failurePhase
            ? { failurePhase, failureCode: "transport_contract_failed" }
            : {}),
          deterministic: true,
          realAdsObserved: false,
          providerExpiryObserved: false,
          finishedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
  }
  if (!passed) throw Error("Transport contract failed");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const request = parseTwitchArguments(process.argv.slice(2));
    if (process.env.VRDEX_PROOF_INNER === "twitch") {
      if (request.case === "public") await runPublicInputWorkload(request);
      else await runTransportWorkload(request);
    } else
      await runProofEnvelope({
        kind: "twitch",
        args: process.argv.slice(2),
        directory: request.outputDir,
        timeoutMs: request.case === "public" ? 2100000 : 360000,
        byteCap: request.case === "public" ? 1700 * 1048576 : 8 * 1048576,
      });
  } catch {
    console.error("Twitch proof failed");
    process.exitCode = 1;
  }
}
