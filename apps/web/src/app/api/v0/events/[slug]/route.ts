import {
  ApiEventUpdateRequestSchema,
  ApiEventWriteResponseSchema,
  PublicEventSchema,
} from "@vrdex/api-contracts";
import { api, internal } from "@convex-generated-api";
import type { Id } from "../../../../../../../../convex/_generated/dataModel";
import {
  apiJson,
  apiProblemResponse,
  publicNotFoundResponse,
  rejectBearerTokenQuery,
  rejectInvalidOrRateLimitedPublicApiRequest,
} from "@/lib/server/api-v0";
import { evaluateApiUserWriteRequest } from "@/lib/server/api-user-authority";
import { convexAdminHttpClient, convexHttpClient } from "@/lib/server/convex-http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

function problem(status: 400 | 403 | 404 | 500, title: string, detail: string) {
  return apiProblemResponse({
    type: "about:blank",
    title,
    status,
    detail,
  });
}

function eventUpdateErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "The event update request is invalid.";

  if (message.includes("permission")) {
    return problem(403, "Event update authority is insufficient", message);
  }

  if (message.includes("not found")) {
    return problem(404, "Event not found", "The requested event was not found.");
  }

  return problem(400, "Invalid event update request", message);
}

export async function GET(request: Request, context: RouteContext) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const rejectedBearerToken = await rejectInvalidOrRateLimitedPublicApiRequest(request);
  if (rejectedBearerToken !== null) {
    return rejectedBearerToken;
  }

  const { slug } = await context.params;
  const event = await convexHttpClient().query(api.events.getPublicBySlug, { slug });

  if (event === null) {
    return publicNotFoundResponse("Event");
  }

  return apiJson(PublicEventSchema, event);
}

export async function PATCH(request: Request, context: RouteContext) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const evaluation = await evaluateApiUserWriteRequest(request, { requiredScope: "events:write" });
  if (!evaluation.ok) {
    return evaluation.response;
  }

  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return problem(400, "Invalid JSON", "Send a JSON object when updating an event.");
  }

  const body = ApiEventUpdateRequestSchema.safeParse(rawBody);
  if (!body.success) {
    return problem(
      400,
      "Invalid event update request",
      body.error.issues[0]?.message ?? "The event update request is invalid.",
    );
  }

  const { slug } = await context.params;

  try {
    const result = await convexAdminHttpClient().mutation(internal.events.updateCommunityEventForApiOwner, {
      actorKind: evaluation.source,
      ownerUserId: evaluation.ownerUserId as Id<"users">,
      currentSlug: slug,
      ...body.data,
    });

    return apiJson(ApiEventWriteResponseSchema, result);
  } catch (error) {
    return eventUpdateErrorResponse(error);
  }
}
