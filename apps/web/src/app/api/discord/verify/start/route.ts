import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { NextResponse, type NextRequest } from "next/server";

import { api } from "@convex-generated-api";
import { appendReturnPathQuery, resolveSameOriginUrl, safeReturnPath } from "@/lib/return-path";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const returnTo = safeReturnPath(request.nextUrl.searchParams.get("returnTo"));
  const token = await convexAuthNextjsToken();

  if (!token) {
    return NextResponse.redirect(
      new URL(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`, request.nextUrl.origin),
    );
  }

  try {
    const { authorizeUrl } = await fetchAction(
      api.discordVerification.startGuildVerification,
      { returnTo },
      { token },
    );

    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    console.error(
      `Discord guild verification start failed: ${error instanceof Error ? error.message : String(error)}`,
    );

    return NextResponse.redirect(
      resolveSameOriginUrl(
        appendReturnPathQuery(returnTo, { discordVerify: "unavailable" }),
        request.nextUrl.origin,
      ),
    );
  }
}
