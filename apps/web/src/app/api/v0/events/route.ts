import {
  ApiEventCreateRequestSchema,
  ApiEventWriteResponseSchema,
} from "@vrdex/api-contracts";
import { internal } from "@convex-generated-api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";

import {
  apiJson,
  apiProblemResponse,
  rejectBearerTokenQuery,
} from "@/lib/server/api-v0";
import { evaluateApiUserWriteRequest } from "@/lib/server/api-user-authority";
import { convexAdminHttpClient } from "@/lib/server/convex-http";

export const dynamic = "force-dynamic";

function problem(status: 400 | 403 | 500, title: string, detail: string) {
  return apiProblemResponse({
    type: "about:blank",
    title,
    status,
    detail,
  });
}

function eventCreateErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "The event creation request is invalid.";

  if (message.includes("permission")) {
    return problem(403, "Event creation authority is insufficient", message);
  }

  return problem(400, "Invalid event creation request", message);
}

export async function POST(request: Request) {
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
    return problem(400, "Invalid JSON", "Send a JSON object when creating an event.");
  }

  const body = ApiEventCreateRequestSchema.safeParse(rawBody);
  if (!body.success) {
    return problem(
      400,
      "Invalid event creation request",
      body.error.issues[0]?.message ?? "The event creation request is invalid.",
    );
  }

  try {
    const result = await convexAdminHttpClient().mutation(internal.events.createCommunityEventForApiOwner, {
      actorKind: evaluation.source,
      ownerUserId: evaluation.ownerUserId as Id<"users">,
      ...body.data,
    });

    return apiJson(ApiEventWriteResponseSchema, result);
  } catch (error) {
    return eventCreateErrorResponse(error);
  }
}
