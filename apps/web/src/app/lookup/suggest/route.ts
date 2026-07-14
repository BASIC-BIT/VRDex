import { NextResponse } from "next/server";

import { fetchProfileLookup } from "@/convex/server";

export const dynamic = "force-dynamic";

const SUGGEST_CACHE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";

  if (!query) {
    return NextResponse.json(
      {
        privateResults: [],
        results: [],
        viewerAccess: { allowed: false, source: "signed_out" },
      },
      { headers: SUGGEST_CACHE_HEADERS },
    );
  }

  const lookup = await fetchProfileLookup(query);

  return NextResponse.json(
    {
      privateResults: lookup.viewerAccess.allowed ? lookup.privateResults : [],
      results: lookup.results,
      viewerAccess: lookup.viewerAccess,
    },
    { headers: SUGGEST_CACHE_HEADERS },
  );
}
