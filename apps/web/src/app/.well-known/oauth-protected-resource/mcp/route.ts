import { mcpProtectedResourceMetadata } from "@/lib/server/oauth-protected-resource-metadata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return Response.json(
    mcpProtectedResourceMetadata(request),
    {
      headers: {
        "cache-control": "public, max-age=300",
      },
    },
  );
}
