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
import {
  apiCredentialHasScope,
  evaluateApiUserWriteRequest,
} from "@/lib/server/api-user-authority";
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

const IDENTITY_SUPPRESSED_DETAIL = "This profile cannot be submitted.";

function profileUpdateErrorResponse(error: unknown) {
  // Structured data first: Convex redacts plain error messages on production
  // deployments, so reading only Error.message returns the serialized payload or
  // generic Convex text instead of the intended reason.
  const data = (error as { data?: { code?: string; message?: string } } | null)?.data;

  if (data?.code === "INVALID_PROFILE_LINK") {
    return problem(400, "Invalid profile update request", data.message ?? "The outbound links are invalid.");
  }

  // Profile field validation answers structured now, the way links already did.
  // Without this an API caller gets the Convex wrapper text for "Display name
  // must be at least 2 characters" -- a redacted message for the one class of
  // failure they could have acted on from the response.
  if (data?.code === "PROFILE_INPUT_INVALID") {
    return problem(
      400,
      "Invalid profile update request",
      data.message ?? "The profile update request is invalid.",
    );
  }

  // A claimed profile is an authority answer, not a malformed request: the
  // caller cannot fix it by correcting the body, and a 400 invites them to try.
  if (data?.code === "PROFILE_CONTRIBUTE_SCOPE_REQUIRED") {
    return problem(
      403,
      "Profile update authority is insufficient",
      data.message ?? "Editing a profile you do not own requires the profile:contribute scope.",
    );
  }

  if (data?.code === "PROFILE_CLAIMED") {
    return problem(
      403,
      "Profile update authority is insufficient",
      data.message ?? "This profile has been claimed, so only its owner can edit it.",
    );
  }

  if (data?.code === "IDENTITY_SUPPRESSED") {
    // Reuses the existing 400 title rather than introducing a 409 with a new one:
    // that would mean unapproved public copy, a wider status union in `problem`,
    // and a new response in both OpenAPI artifacts. The approved message still
    // reaches the caller as the problem detail, which is the part that matters.
    return problem(400, "Invalid profile update request", data.message ?? IDENTITY_SUPPRESSED_DETAIL);
  }

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
      actorKind: evaluation.source,
      ownerUserId: evaluation.ownerUserId as Id<"users">,
      currentSlug: slug,
      contributeGranted: apiCredentialHasScope(evaluation.context, "profile:contribute"),
      ...body.data,
    });

    return apiJson(ApiProfileWriteResponseSchema, result);
  } catch (error) {
    return profileUpdateErrorResponse(error);
  }
}
