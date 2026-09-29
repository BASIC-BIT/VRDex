import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../../../../../convex/_generated/dataModel";
import { convexAuthToken } from "@/lib/server/auth";
import { convexHttpClient } from "@/lib/server/convex-http";
import { getProfileAssetObject } from "@/lib/server/profile-asset-storage";
import { createMcpMediaReviewHandlers } from "@/lib/server/mcp-media-review";

export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  const token = await convexAuthToken();
  if (!token) return new Response(null, { status: 401 });
  const convex = convexHttpClient();
  convex.setAuth(token);
  const { submissionId } = await context.params;
  try {
    // Browser authority is derived by each query. No client-selected actor is forwarded.
    const handlers = createMcpMediaReviewHandlers({
      actorUserId: "browser",
      now: Date.now,
      verifyContributorEmail: async () => true,
      query: async (name) =>
        convex.query(
          name === "detail"
            ? api.profileMediaSubmissions.publisherDetail
            : api.profileMediaSubmissions.publisherCandidateForStorage,
          { submissionId: submissionId as Id<"profileMediaSubmissions"> },
        ),
      mutate: async () => {
        throw new Error("Read only");
      },
      readStoredObject: getProfileAssetObject,
    });
    const result = await handlers.preview({
      submissionId,
      expectedReviewVersion: new URL(request.url).searchParams.get("version"),
    });
    const image = result.content.find((part) => part.type === "image");
    if (!image || image.type !== "image")
      return new Response(null, { status: 409 });
    return new Response(new Uint8Array(Buffer.from(image.data, "base64")), {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
      },
    });
  } catch {
    return new Response(null, { status: 403 });
  }
}
