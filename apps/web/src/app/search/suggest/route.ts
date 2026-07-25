import { NextResponse } from "next/server";

import { fetchDiscoverySearch } from "@/convex/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 120) ?? "";

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const search = await fetchDiscoverySearch(query, "all", 8);

  return NextResponse.json(
    { results: search.results.slice(0, 8) },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
      status: search.kind === "error" ? 503 : 200,
    },
  );
}
