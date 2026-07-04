import { oauthPublicJwks } from "@/lib/server/oauth-jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  try {
    return Response.json(oauthPublicJwks(), {
      headers: {
        "cache-control": "public, max-age=300",
      },
    });
  } catch {
    return Response.json(
      {
        keys: [],
      },
      {
        headers: {
          "cache-control": "no-store",
        },
        status: 503,
      },
    );
  }
}
