import {
  ApiProfileUpdateRequestSchema,
  ApiProfileWriteResponseSchema,
  PublicProfileSchema,
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

function profileUpdateErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "The profile update request is invalid.";

  if (message.includes("permission") || message.includes("Only a claimed profile owner")) {
    return problem(403, "Profile update authority is insufficient", message);
  }

  if (message.includes("not found")) {
    return problem(404, "Profile not found", "The requested profile was not found.");
  }

  return problem(400, "Invalid profile update request", message);
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
  const profile = await convexHttpClient().query(api.profiles.getPublicBySlug, { slug, now: Date.now() });

  if (profile === null) {
    return publicNotFoundResponse("Profile");
  }

  return apiJson(PublicProfileSchema, profile);
}

export async function PATCH(request: Request, context: RouteContext) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const evaluation = await evaluateApiUserWriteRequest(request, { requiredScope: "profile:write" });
  if (!evaluation.ok) {
    return evaluation.response;
  }

  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return problem(400, "Invalid JSON", "Send a JSON object when updating a profile.");
  }

  const body = ApiProfileUpdateRequestSchema.safeParse(rawBody);
  if (!body.success) {
    return problem(
      400,
      "Invalid profile update request",
      body.error.issues[0]?.message ?? "The profile update request is invalid.",
    );
  }

  const { slug } = await context.params;

  try {
    const result = await convexAdminHttpClient().mutation(internal.profiles.updateProfileForApiOwner, {
      ownerUserId: evaluation.ownerUserId as Id<"users">,
      currentSlug: slug,
      ...body.data,
    });

    return apiJson(ApiProfileWriteResponseSchema, result);
  } catch (error) {
    return profileUpdateErrorResponse(error);
  }
}
