import { randomUUID } from "node:crypto";
import { LangfuseClient } from "@langfuse/client";
import type { EventIntakeGeneration, EventIntakeSink } from "./index";

// Uses the legacy ingestion endpoint: the client's only trace path without OpenTelemetry.
export function createLangfuseSink(options: { publicKey: string; secretKey: string; baseUrl?: string }): EventIntakeSink {
  const client = new LangfuseClient(options);
  return { start(meta) {
    const traceId = randomUUID(), turns: Array<EventIntakeGeneration & { at: number }> = [];
    return {
      generation(turn) { turns.push({ ...turn, at: Date.now() }); },
      async end(result) {
        const now = new Date().toISOString();
        const tags = [meta.trigger, meta.mode, result.decision?.kind, meta.connectorId && `connector:${meta.connectorId}`].filter((tag): tag is string => Boolean(tag));
        const { reason, turns: turnCount, toolCalls, durationMs, costUsd } = result;
        try {
          await client.api.ingestion.batch({ batch: [
            { type: "trace-create", id: randomUUID(), timestamp: now, body: { id: traceId, timestamp: now, name: "event-intake", tags, metadata: { draftId: meta.draftId, reason, turns: turnCount, toolCalls, durationMs, costUsd }, output: result.decision } },
            ...turns.map(turn => ({ type: "generation-create" as const, id: randomUUID(), timestamp: now, body: {
              id: randomUUID(), traceId, name: `turn-${turn.turn}`, model: turn.model, input: turn.request, output: turn.response,
              startTime: new Date(turn.at - turn.latencyMs).toISOString(), endTime: new Date(turn.at).toISOString(), usageDetails: { input: turn.inputTokens, output: turn.outputTokens },
            } })),
          ] }, { timeoutInSeconds: 5, maxRetries: 0 }); // the agent awaits end, so a slow Langfuse must not hold the run
        } catch { /* tracing never affects a run */ }
      },
    };
  } };
}

export function createPostHogSink(enqueue: (event: { event: "event_intake_run"; distinctId: string; properties: Record<string, unknown> }) => Promise<void>): EventIntakeSink {
  return { start: meta => ({
    generation() {},
    async end(result) {
      const properties = { trigger: meta.trigger, connector_id: meta.connectorId, community: meta.communitySlug, mode: meta.mode, decision: result.decision?.kind, reason: result.reason, turns: result.turns,
        tool_calls: result.toolCalls, input_tokens: result.inputTokens, output_tokens: result.outputTokens, duration_ms: result.durationMs, cost_usd: result.costUsd };
      try { await enqueue({ event: "event_intake_run", distinctId: `event_intake:${meta.draftId}`, properties: Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined)) }); }
      catch { /* analytics never affects a run */ }
    },
  }) };
}

export function composeSinks(...sinks: EventIntakeSink[]): EventIntakeSink {
  return { start(meta) {
    const handles = sinks.flatMap(sink => { try { return [sink.start(meta)]; } catch { return []; } });
    return {
      generation(turn) { for (const handle of handles) try { handle.generation(turn); } catch { /* isolate sinks */ } },
      async end(result) { await Promise.allSettled(handles.map(async handle => handle.end(result))); },
    };
  } };
}
