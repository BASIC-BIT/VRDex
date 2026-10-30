import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { GenericId } from "convex/values";

import { internal } from "@convex-generated-api";
import { appendReturnPathQuery, resolveSameOriginUrl } from "@/lib/return-path";
import { convexAuthToken, isUnauthenticatedError, unauthenticatedRedirectResponse, viewerQuery } from "@/lib/server/auth";
import { convexAdminHttpClient, convexHttpClient } from "@/lib/server/convex-http";
import {
  GOOGLE_CONNECTOR_CALLBACK_PATH, GOOGLE_CONNECTOR_STATE_COOKIE, encodeStateCookie, errorCode, googleAuthorizeUrl, integrationsPath, stateCookieOptions,
} from "@/lib/server/google-connector-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const communitySlug = request.nextUrl.searchParams.get("community");
  const connectorId = request.nextUrl.searchParams.get("connectorId") || undefined;
  const returnPath = communitySlug ? integrationsPath(communitySlug) : "/account";
  const failed = () => NextResponse.redirect(resolveSameOriginUrl(appendReturnPathQuery(returnPath, { googleCalendar: "failed" }), request.nextUrl.origin));
  if (!communitySlug) return failed();

  try {
    const token = await convexAuthToken();
    if (!token) return unauthenticatedRedirectResponse(request, returnPath);
    const client = convexHttpClient();
    client.setAuth(token);
    const actorUserId = (await client.query(viewerQuery, {}))?.user.id;
    if (!actorUserId) return unauthenticatedRedirectResponse(request, returnPath);
    const clientId = process.env.GOOGLE_CONNECTOR_CLIENT_ID;
    if (!clientId) throw new Error("GOOGLE_CONNECTOR_CLIENT_MISSING");
    await convexAdminHttpClient().query(internal.googleCalendarConnector.authorizeConnect, {
      actorUserId, communitySlug, connectorId: connectorId as GenericId<"eventConnectors"> | undefined,
    });
    const state = randomBytes(32).toString("base64url");
    const response = NextResponse.redirect(googleAuthorizeUrl({ clientId, redirectUri: request.nextUrl.origin + GOOGLE_CONNECTOR_CALLBACK_PATH, state }));
    response.cookies.set(GOOGLE_CONNECTOR_STATE_COOKIE, encodeStateCookie({ state, communitySlug, connectorId }), { ...stateCookieOptions, maxAge: 600 });
    return response;
  } catch (error) {
    if (isUnauthenticatedError(error)) return unauthenticatedRedirectResponse(request, returnPath);
    console.error(`Google Calendar connect start failed: ${errorCode(error)}`);
    return failed();
  }
}
