import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import type { GenericId } from "convex/values";

import { api, internal } from "@convex-generated-api";
import { convexAdminHttpClient, convexHttpClient } from "@/lib/server/convex-http";
import {
  generateProfileAssetAccessibilityDescription,
  isProfileAssetAccessibilityGenerationConfigured,
  parseAccessibilityImageDataUrl,
  profileAssetAccessibilityModel,
  ProfileAssetAccessibilityProviderError,
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
  const authToken = await convexAuthNextjsToken();
  if (authToken === undefined) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 2_100_000) {
    return Response.json({ error: "Image preview is too large." }, { status: 413 });
  }

  try {
    const body = await request.json() as { imageDataUrl?: unknown; requestId?: unknown };
    const image = await parseAccessibilityImageDataUrl(body.imageDataUrl);
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
      imageBytes: image.byteSize,
    });
    if (claim.replay) {
      return Response.json({ error: "Generation request was already used." }, { status: 409 });
    }
    const startedAt = Date.now();
    try {
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
    const status =
      error instanceof ProfileAssetAccessibilityProviderError && error.code === "invalid_image"
        ? 400
        : message.includes("permission") || message.includes("owner")
          ? 403
          : message.includes("limit") || message.includes("Wait a moment")
            ? 429
            : 502;
    return Response.json({ error: message }, { status });
  }
}
