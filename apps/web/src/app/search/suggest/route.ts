import { NextResponse } from "next/server";

import { parseSearchFilter } from "../../_components/search-view-state";
import { fetchDiscoverySearch } from "@/convex/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const query = searchParams.get("q")?.trim().slice(0, 120) ?? "";
  const filter = parseSearchFilter(searchParams.get("type") ?? undefined);

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const search = await fetchDiscoverySearch(query, filter, 8);

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
