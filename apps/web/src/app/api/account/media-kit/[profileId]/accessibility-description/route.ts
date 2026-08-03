import { convexAuthToken } from "@/lib/server/auth";
import type { GenericId } from "convex/values";

import { api, internal } from "@convex-generated-api";
import { convexAdminHttpClient, convexHttpClient } from "@/lib/server/convex-http";
import {
  generateProfileAssetAccessibilityDescription,
  inspectAccessibilityImageDataUrl,
  isProfileAssetAccessibilityGenerationConfigured,
  parseAccessibilityImageDataUrl,
  profileAssetAccessibilityErrorStatus,
  profileAssetAccessibilityModel,
  ProfileAssetAccessibilityProviderError,
  readProfileAssetAccessibilityRequest,
} from "@/lib/server/profile-asset-accessibility";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    profileId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  if (!isProfileAssetAccessibilityGenerationConfigured()) {
    return Response.json({ error: "Generation is unavailable." }, { status: 503 });
  }
  const authToken = await convexAuthToken();
  if (authToken === undefined) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  try {
    const body = await readProfileAssetAccessibilityRequest(request);
    const imageEnvelope = inspectAccessibilityImageDataUrl(body.imageDataUrl);
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    const { profileId } = await context.params;
    const convex = convexHttpClient();
    convex.setAuth(authToken);
    const model = profileAssetAccessibilityModel();
    const claim = await convex.mutation(api.profileAssets.claimOwnedAccessibilityGeneration, {
      profileId: profileId as GenericId<"profiles">,
      requestId,
      provider: "openai",
      model,
      imageBytes: imageEnvelope.byteSize,
    });
    if (claim.replay) {
      return Response.json({ error: "Generation request was already used." }, { status: 409 });
    }
    const startedAt = Date.now();
    try {
      const image = await parseAccessibilityImageDataUrl(body.imageDataUrl);
      const generated = await generateProfileAssetAccessibilityDescription(image, {
        userId: String(claim.userId),
      });
      await convexAdminHttpClient().mutation(internal.profileAssets.finishAccessibilityGeneration, {
        eventId: claim.eventId,
        requestId,
        result: "succeeded",
        descriptionLength: generated.description.length,
        latencyMs: Date.now() - startedAt,
      });
      return Response.json({ description: generated.description });
    } catch (error) {
      const errorCode =
        error instanceof ProfileAssetAccessibilityProviderError ? error.code : "provider";
      await convexAdminHttpClient().mutation(internal.profileAssets.finishAccessibilityGeneration, {
        eventId: claim.eventId,
        requestId,
        result: "failed",
        latencyMs: Date.now() - startedAt,
        errorCode,
      }).catch(() => false);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed. Try again.";
    return Response.json(
      { error: message },
      { status: profileAssetAccessibilityErrorStatus(error) },
    );
  }
}
