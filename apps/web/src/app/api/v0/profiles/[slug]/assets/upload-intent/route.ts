import {
  ApiProfileAssetUploadIntentCreateRequestSchema,
  ApiProfileAssetUploadIntentCreateResponseSchema,
} from "@vrdex/api-contracts";
import { internal } from "@convex-generated-api";
import type { Id } from "../../../../../../../../../../convex/_generated/dataModel";

import { apiJson, apiProblemResponse, rejectBearerTokenQuery } from "@/lib/server/api-v0";
import { evaluateApiUserAssetUploadRequest } from "@/lib/server/api-user-authority";
import { convexAdminHttpClient } from "@/lib/server/convex-http";

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

function uploadIntentErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "The profile asset upload intent request is invalid.";

  if (message.includes("permission") || message.includes("Only a claimed profile owner")) {
    return problem(403, "Profile asset upload authority is insufficient", message);
  }

  if (message.includes("not found")) {
    return problem(404, "Profile not found", "The requested profile was not found.");
  }

  return problem(400, "Invalid profile asset upload intent request", message);
}

export async function POST(request: Request, context: RouteContext) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const evaluation = await evaluateApiUserAssetUploadRequest(request, { requiredScope: "assets:write" });
  if (!evaluation.ok) {
    return evaluation.response;
  }

  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return problem(400, "Invalid JSON", "Send a JSON object when creating a profile asset upload intent.");
  }

  const body = ApiProfileAssetUploadIntentCreateRequestSchema.safeParse(rawBody);
  if (!body.success) {
    return problem(
      400,
      "Invalid profile asset upload intent request",
      body.error.issues[0]?.message ?? "The profile asset upload intent request is invalid.",
    );
  }

  const { slug } = await context.params;

  try {
    const result = await convexAdminHttpClient().mutation(internal.profileAssets.createUploadIntentForApiProfileOwner, {
      ownerUserId: evaluation.ownerUserId as Id<"users">,
      slug,
      ...body.data,
    });

    return apiJson(ApiProfileAssetUploadIntentCreateResponseSchema, result);
  } catch (error) {
    return uploadIntentErrorResponse(error);
  }
}
