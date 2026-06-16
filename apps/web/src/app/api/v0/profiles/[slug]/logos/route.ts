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
  const result = await convexHttpClient().query(api.profileAssets.listPublicBySlug, { slug });

  if (result === null) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  return NextResponse.json({
    profileType: result.profileType,
    slug: result.slug,
    displayName: result.displayName,
    primaryLogo: result.mediaKit.primaryLogo,
    additionalLogos: result.mediaKit.additionalLogos,
    logos: result.mediaKit.logos,
    logoZipUrl: result.mediaKit.logoZipUrl,
  });
}
