import { NextResponse } from "next/server";

import { fetchProfileLookup } from "@/convex/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const lookup = await fetchProfileLookup(query);

  return NextResponse.json({ results: lookup.results });
}
