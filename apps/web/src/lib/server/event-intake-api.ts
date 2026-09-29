import {
  z,
  eventIntakeOperations, type EventIntakeOperation, SaveEventIntakeDraftSchema,
  EventIntakeDraftIdSchema, PublishEventIntakeSchema, ExtractEventIntakeSchema,
  BeginEventPosterUploadSchema, CompleteEventPosterUploadSchema, SelectEventArtworkSchema,
  UpdateEventContributionSchema, RetractEventContributionSchema, GetEventContributionSchema, ReportEventSchema,
} from "@vrdex/api-contracts";
import { api, internal } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { convexAdminHttpClient, convexHttpClient } from "./convex-http";
import { createEventPosterHandlers } from "./event-poster-storage";
import { createEventIntakeExtractor } from "./event-intake-agent";
import { getProfileAssetObject } from "./profile-asset-storage";
import { evaluateApiUserReadRequest, evaluateApiUserWriteRequest } from "./api-user-authority";
import { apiProblemResponse, rejectBearerTokenQuery } from "./api-v0";

type Admin = Pick<ReturnType<typeof convexAdminHttpClient>, "query" | "mutation" | "action">;
export function createEventIntakeCommands(deps: { actorUserId: Id<"users">; admin?: Admin; actorSurface?: "api" | "mcp" }) {
  const admin = deps.admin ?? convexAdminHttpClient();
  const actor = { actorUserId: deps.actorUserId };
  const posters = createEventPosterHandlers({ authority: async () => actor, admin });
  const extract = createEventIntakeExtractor({ authority: async () => actor, admin, readPoster: id => posters.readPoster(id as Id<"eventPosterSources">) });
  const draftId = (value: string) => value as Id<"eventIntakeDrafts">;
  const posterAssetId = (value: string) => value as Id<"eventPosterSources">;
  const eventId = async (slug: string) => {
    const event = await admin.query(api.events.getPublicBySlug, { slug });
    if (!event) throw new Error("EVENT_NOT_FOUND");
    return event.id as Id<"events">;
  };
  return async (operation: EventIntakeOperation, raw: unknown) => {
    let result: unknown;
    switch (operation) {
      case "draft_save": {
        const input = SaveEventIntakeDraftSchema.parse(raw);
        result = await admin.mutation(internal.eventIntake.saveActorDraft, { ...input, ...actor, draftId: input.draftId ? draftId(input.draftId) : undefined });
        break;
      }
      case "draft_get": {
        const input = EventIntakeDraftIdSchema.parse(raw);
        const draft = await admin.query(internal.eventIntake.getActorDraft, { ...actor, draftId: draftId(input.draftId) });
        result = { ...draft, draftId: draft._id };
        break;
      }
      case "publish": {
        const input = PublishEventIntakeSchema.parse(raw);
        result = await admin.action(internal.eventIntake.publishActorIntake, { ...input, ...actor, actorSurface: deps.actorSurface ?? "api", draftId: draftId(input.draftId) });
        break;
      }
      case "extract": result = await extract(ExtractEventIntakeSchema.parse(raw)); break;
      case "poster_upload_begin": {
        const input = BeginEventPosterUploadSchema.parse(raw);
        result = await posters.beginPosterUpload({ ...input, draftId: draftId(input.draftId) });
        break;
      }
      case "poster_upload_complete": {
        const input = CompleteEventPosterUploadSchema.parse(raw);
        const source = await admin.query(internal.eventIntakeSources.readActorSource, { ...actor, posterAssetId: posterAssetId(input.posterAssetId) });
        if (source.draftId !== input.draftId) throw new Error("POSTER_DRAFT_MISMATCH");
        result = await posters.completePosterUpload({ posterAssetId: posterAssetId(input.posterAssetId) });
        break;
      }
      case "artwork_select": {
        const input = SelectEventArtworkSchema.parse(raw);
        result = await posters.selectPosterArtwork({ ...input, draftId: draftId(input.draftId), posterAssetId: posterAssetId(input.posterAssetId) });
        break;
      }
      case "event_update": {
        const { slug, ...input } = UpdateEventContributionSchema.parse(raw);
        result = await admin.mutation(internal.eventCorrections.updateActorContributedEvent, { ...input, ...actor, actorSurface: deps.actorSurface ?? "api", eventId: await eventId(slug), duplicateAcknowledgements: input.duplicateAcknowledgements as Id<"events">[] | undefined });
        break;
      }
      case "event_get": {
        const { slug } = GetEventContributionSchema.parse(raw);
        const ownEventId = await admin.query(internal.eventCorrections.getActorContributedEventIdBySlug, { ...actor, slug });
        result = await admin.query(internal.eventCorrections.getActorContributedEvent, { ...actor, eventId: ownEventId });
        break;
      }
      case "event_retract": {
        const { slug } = RetractEventContributionSchema.parse(raw);
        const ownEventId = await admin.query(internal.eventCorrections.getActorContributedEventIdBySlug, { ...actor, slug });
        result = await admin.mutation(internal.eventCorrections.retractActorContributedEvent, { ...actor, actorSurface: deps.actorSurface ?? "api", eventId: ownEventId });
      }
    }
    return eventIntakeOperations[operation].output.parse(result);
  };
}

function problem(status: number, title: string, detail?: string) {
  const response = apiProblemResponse({ type: "about:blank", status, title, detail });
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export async function handleEventIntakeRequest(request: Request, operation: EventIntakeOperation, params: Record<string, string> = {}) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected) return rejected;
  const evaluation = await (["draft_get", "event_get"].includes(operation) ? evaluateApiUserReadRequest : evaluateApiUserWriteRequest)(request, { requiredScope: "events:contribute" });
  if (!evaluation.ok) return evaluation.response;
  let input: unknown;
  try {
    const body: unknown = request.method === "GET" || request.method === "DELETE" ? {} : await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return problem(400, "Invalid request");
    if (Object.entries(params).some(([key, value]) => key in body && body[key as keyof typeof body] !== value)) return problem(400, "Path mismatch");
    input = eventIntakeOperations[operation].input.parse({ ...body, ...params });
  } catch { return problem(400, "Invalid request"); }
  try {
    const result = await createEventIntakeCommands({ actorUserId: evaluation.ownerUserId as Id<"users"> })(operation, input);
    return Response.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return eventIntakeErrorResponse(error);
  }
}

// Never relay backend exception text, which can include private source content.
export function eventIntakeErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const data = typeof error === "object" && error && "data" in error ? error.data : undefined;
  const duplicate = z.object({ code: z.literal("NEAR_DUPLICATE"), choices: z.array(z.object({ eventId: z.string().max(200), title: z.string().max(120), eventPath: z.string().max(2048).startsWith("/") })).max(20) }).safeParse(data);
  if (duplicate.success) return problem(409, "Near duplicate", JSON.stringify(duplicate.data));
  const code = data === undefined ? message : JSON.stringify(data);
  if (/VERSION_CONFLICT|IDEMPOTENCY_CONFLICT|CONTRIBUTOR_EDIT_CLOSED|DUPLICATE_EVENT/.test(code)) return problem(409, "Conflict");
  if (/QUOTA|LIMIT/.test(code)) return problem(429, "Limit reached");
  if (/NOT_FOUND|not found|DRAFT_ACCESS|CONTRIBUTOR_REQUIRED|POSTER_ACCESS/.test(code)) return problem(403, "Unavailable");
  if (/REPOST_BLOCKED|CONTENT_BLOCKED/.test(code)) return problem(403, "Publication refused");
  if (error instanceof z.ZodError || /POSTER_|ARTWORK_|PATCH_FIELD|CLASSIFICATION_VERSION_CONFLICT/.test(code)) return problem(400, "Invalid intake request");
  if (/A public community|Event date|Timed publication|Time TBA|Choose a start|Event start|End time|Doors must|Every published lineup|published public community|World match|Source URL|Published drafts|A draft needs|Draft exceeds|Local time|Ambiguous local time|Invalid time zone|date-only|Lineup match|Timed sets|Set times|Selected stream/i.test(message)) return problem(400, "Invalid intake request");
  return problem(503, "Event intake response unavailable");
}

export async function readEventArtwork(eventId: string, artworkAssetId: string, deps: {
  query?: ReturnType<typeof convexHttpClient>["query"]; read?: typeof getProfileAssetObject;
} = {}) {
  const args = { artworkAssetId: artworkAssetId as Id<"eventPosterArtwork"> };
  const artwork = deps.query ? await deps.query(api.eventIntakeSources.publicArtwork, args) : await convexHttpClient().query(api.eventIntakeSources.publicArtwork, args);
  if (!artwork || artwork.eventId !== eventId || !artwork.storageKey) return problem(404, "Not found");
  const object = await (deps.read ?? getProfileAssetObject)(artwork.storageKey);
  if (!object || object.contentType !== "image/webp") return problem(404, "Not found");
  return new Response(new Uint8Array(object.body), { headers: { "content-type": "image/webp", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}

export async function reportEventRequest(request: Request, slug: string) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected) return rejected;
  try {
    const input = ReportEventSchema.parse(await request.json());
    const client = convexHttpClient();
    const event = await client.query(api.events.getPublicBySlug, { slug });
    if (!event) return problem(404, "Not found");
    // Visitor reports use the same durable event/global caps as the website.
    const result = await client.mutation(api.eventCorrections.reportEvent, { ...input, eventId: event.id as Id<"events"> });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) { return eventIntakeErrorResponse(error); }
}
