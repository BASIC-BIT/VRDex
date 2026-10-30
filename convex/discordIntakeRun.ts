"use node";

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { notifyOps, resolveOps } from "./_opsAlerts";
import { composeSinks, createLangfuseSink, createPostHogSink, extractEventIntake, type EventIntakeSink } from "../packages/event-intake-agent/src/index";

const POSTER_ROUTE = "/api/internal/discord-intake/poster";
const REASON = /^[A-Za-z][A-Za-z0-9_]{2,63}$/;
const POSTER_ALERT_KEY = "discord-intake-posters";

/** The web poster bridge: only the web server holds the bucket role. */
async function posterBridge<T>(body: Record<string, unknown>): Promise<T> {
  const token = process.env.VRDEX_DISCORD_POSTER_TOKEN, site = process.env.SITE_URL;
  if (!token || !site) throw new Error("POSTER_BRIDGE_UNCONFIGURED");
  const response = await fetch(new URL(POSTER_ROUTE, site), {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error("POSTER_BRIDGE_FAILED");
  return response.json() as Promise<T>;
}

/** The same data URL the web poster handlers build, fetched through the bridge's short-lived link. */
async function readPoster(runId: Id<"discordIntakeRuns">, actorUserId: Id<"users">, posterAssetId: string) {
  try {
    const { url, mimeType } = await posterBridge<{ url: string; mimeType: string }>({ op: "read", actorUserId, posterAssetId });
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("POSTER_READ_FAILED");
    return `data:${mimeType};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
  } catch (error) {
    // The agent reports any read failure as invalid_response, so the real cause is logged here.
    console.warn("discord intake poster read failed", { runId, reason: failureReason(error) });
    throw error;
  }
}

// Errors can carry signed URLs; keep messages for logs only after stripping them.
const scrub = (message: string) => message.replace(/https?:\/\/\S+/g, "[url]").slice(0, 500);
export function failureReason(error: unknown) {
  const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
  if (typeof code === "string" && REASON.test(code)) return code;
  const message = error instanceof Error ? error.message : "";
  return REASON.test(message) ? message : "run_failed";
}

/** Runs one author's settled messages through the intake agent, then applies or fails the run. */
export const runPending = internalAction({
  args: { runId: v.id("discordIntakeRuns") },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const claim = await ctx.runMutation(internal.discordIntake.claimRun, { runId });
    if (claim.kind === "skip") return null;
    try {
      const draftId = await ctx.runMutation(internal.discordIntake.saveRunDraft, { runId, sourceText: claim.sourceText, sourceUrl: claim.sourceUrl });
      const posterIds: string[] = [];
      let posterFailure = "";
      for (const poster of claim.posters) {
        try {
          posterIds.push((await posterBridge<{ posterAssetId: string }>({ op: "store", actorUserId: claim.authorityUserId, draftId, ...poster })).posterAssetId);
        } catch (error) {
          // A poster that cannot be stored drops out; the run continues with the rest and the text.
          posterFailure = failureReason(error);
          console.warn("discord intake poster skipped", { runId, reason: posterFailure });
        }
      }
      if (posterIds.length) await resolveOps(ctx, POSTER_ALERT_KEY);
      else if (claim.posters.length) await notifyOps(ctx, { key: POSTER_ALERT_KEY, subject: "Discord intake posters failing", body: `Poster storage failed: ${posterFailure}.` });
      const updatedAt = new Map<string, number>();
      const lookup = async (query: string, limit: number, profileType: "person" | "community") =>
        (await ctx.runQuery(api.search.searchUniversal, { query, limit, entityType: "profile", profileType })).map(row => ({ slug: row.slug, displayName: row.title }));
      const { LANGFUSE_PUBLIC_KEY: publicKey, LANGFUSE_SECRET_KEY: secretKey } = process.env;
      const sinks: EventIntakeSink[] = [createPostHogSink(event => ctx.runMutation(internal.productAnalytics.enqueue, event).then(() => undefined))];
      if (publicKey && secretKey) sinks.push(createLangfuseSink({ publicKey, secretKey, baseUrl: process.env.LANGFUSE_BASE_URL || undefined }));
      const candidate = await extractEventIntake({ draftId, sourceText: claim.sourceText, posterAssetId: posterIds[0], context: claim.context }, {
        authorize: (input, reserveQuota) => ctx.runMutation(internal.eventIntakeSources.authorizeExtraction, {
          actorUserId: claim.authorityUserId, draftId, reserveQuota, connectorId: claim.context.connectorId,
          ...(input.posterAssetId ? { posterAssetId: input.posterAssetId as Id<"eventPosterSources"> } : {}),
        }),
        search_people: (query, limit) => lookup(query, limit, "person"),
        search_communities: (query, limit) => lookup(query, limit, "community"),
        list_events: limit => ctx.runQuery(internal.discordIntake.listEventsForAgent, { runId, limit }),
        get_event: async slug => {
          const event = await ctx.runQuery(internal.discordIntake.getEventForAgent, { runId, slug });
          if (!event) return null;
          updatedAt.set(slug, event.updatedAt);
          return event.fields;
        },
        readPoster: posterAssetId => readPoster(runId, claim.authorityUserId, posterAssetId),
        sink: composeSinks(...sinks),
      });
      // The agent never throws: an unavailable model or a provider error comes back as a fallback asking about the source.
      const fallback = candidate.questions[0]?.fieldPath === "source" ? candidate.questions[0] : undefined;
      if (fallback) {
        await ctx.runMutation(internal.discordIntake.failRun, { runId, reason: REASON.test(fallback.reason) ? fallback.reason : "extraction_failed" });
        return null;
      }
      const expectedUpdatedAt = candidate.decision.kind === "update" ? updatedAt.get(candidate.decision.slug) : undefined;
      await ctx.runMutation(internal.discordIntake.finishRun, { runId, draftId, candidate, ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }) });
    } catch (error) {
      console.error("discord intake run failed", { runId, detail: scrub(error instanceof Error ? error.message : String(error)) });
      await ctx.runMutation(internal.discordIntake.failRun, { runId, reason: failureReason(error) });
    }
    return null;
  },
});
