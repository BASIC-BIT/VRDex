import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDeterministicTemporalToolImplementations,
  executeTemporalPlanPlannerOutput,
  parseCalendarContext,
  parseTemporalExpression,
  parseTemporalPlanPlannerOutput,
} from "../src/index";

async function execute(input: unknown, text: string) {
  return executeTemporalPlanPlannerOutput(
    parseTemporalPlanPlannerOutput(input),
    {
      text,
      calendarContext: parseCalendarContext(
        "America/Indianapolis",
        "2026-07-22T12:00:00.000Z",
      ),
    },
    {
      implementations: createDeterministicTemporalToolImplementations(),
      features: { planIr: true, deterministicPreflight: true },
      method: "agent+plan",
      modelName: "executor-test@immutable",
      planningDurationMs: 1,
    },
  );
}

const tomorrowAtEight = {
  outcome: "plans",
  reason: "Tomorrow with an explicit clock time.",
  plans: [{
    kind: "instant",
    label: "tomorrow at 8pm",
    confidence: 0.98,
    finalStep: 1,
    steps: [
      { op: "resolve_calendar_query", query: "tomorrow" },
      { op: "set_clock_time", baseStep: 0, time: { hour: 20, minute: 0 } },
    ],
  }],
};

describe("migrated temporal Plan-IR executor", () => {
  it("normalizes an adversarial run of trailing endpoint slashes in linear time", async () => {
    const previousFetch = globalThis.fetch;
    let requestedUrl: string | undefined;
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        choices: [{ text: JSON.stringify({ outcome: "no_plan", reason: "No supported expression.", plans: [] }) }],
      }), { status: 200 });
    };

    try {
      await parseTemporalExpression({
        text: "whenever vibes are right",
        timeZone: "America/Indianapolis",
        referenceInstant: "2026-07-22T12:00:00.000Z",
        features: { planIr: true },
        planIrEndpoint: {
          baseUrl: `https://model.test${"/".repeat(100_000)}`,
          model: "executor-test@immutable",
          instructionPreset: "minimal",
          api: "completions",
          promptFormat: "custom",
          maxTokens: 256,
          timeoutMs: 1_000,
        },
      });
    } finally {
      globalThis.fetch = previousFetch;
    }

    assert.equal(requestedUrl, "https://model.test/v1/completions");
  });

  it("resolves a date and clock time to one canonical instant", async () => {
    const result = await execute(tomorrowAtEight, "tomorrow at 8pm");

    assert.equal(result.status, "resolved");
    assert.equal(result.kind, "instant");
    assert.equal(result.canonical?.isoInstant, "2026-07-24T00:00:00Z");
    assert.equal(result.canonical?.timeZone, "America/Indianapolis");
    assert.equal(result.epoch, 1784851200);
  });

  it("returns an ordered canonical range from one date anchor", async () => {
    const result = await execute({
      outcome: "plans",
      reason: "Tomorrow with a two-hour window.",
      plans: [{
        kind: "time_range",
        label: "tomorrow 8pm to 10pm",
        confidence: 0.97,
        startStep: 1,
        endStep: 2,
        steps: [
          { op: "resolve_calendar_query", query: "tomorrow" },
          { op: "set_clock_time", baseStep: 0, time: { hour: 20, minute: 0 } },
          { op: "set_clock_time", baseStep: 0, time: { hour: 22, minute: 0 } },
        ],
      }],
    }, "tomorrow 8pm to 10pm");

    assert.equal(result.status, "resolved");
    assert.equal(result.kind, "time_range");
    assert.equal(result.range?.start.canonical.isoInstant, "2026-07-24T00:00:00Z");
    assert.equal(result.range?.end.canonical.isoInstant, "2026-07-24T02:00:00Z");
    assert.ok((result.range?.start.epoch ?? 0) < (result.range?.end.epoch ?? 0));
  });
  it("preserves no-plan instead of inventing a timestamp", async () => {
    const result = await execute({
      outcome: "no_plan",
      reason: "No supported temporal expression.",
      plans: [],
    }, "whenever vibes are right");

    assert.equal(result.status, "failed");
    assert.equal(result.epoch, undefined);
  });
});
