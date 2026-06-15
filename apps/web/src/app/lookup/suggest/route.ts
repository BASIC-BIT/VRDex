import { NextResponse } from "next/server";

import { fetchProfileLookup } from "@/convex/server";

export const dynamic = "force-dynamic";

const SUGGEST_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=10, stale-while-revalidate=30",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";

  if (!query) {
    return NextResponse.json({ results: [] }, { headers: SUGGEST_CACHE_HEADERS });
  }

  const lookup = await fetchProfileLookup(query);

  return NextResponse.json({ results: lookup.results }, { headers: SUGGEST_CACHE_HEADERS });
}
