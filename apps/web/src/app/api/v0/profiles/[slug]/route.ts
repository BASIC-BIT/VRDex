import { NextResponse } from "next/server";

import { api } from "@convex-generated-api";
import { convexHttpClient } from "@/lib/server/convex-http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const profile = await convexHttpClient().query(api.profiles.getPublicBySlug, { slug });

  if (profile === null) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  return NextResponse.json(profile);
}
