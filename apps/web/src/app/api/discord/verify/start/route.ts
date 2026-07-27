import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { NextResponse, type NextRequest } from "next/server";

import { api } from "@convex-generated-api";

export const dynamic = "force-dynamic";

function safeReturnTo(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/account";
}

export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
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
      new URL(`${returnTo}${returnTo.includes("?") ? "&" : "?"}discordVerify=unavailable`, request.nextUrl.origin),
    );
  }
}
