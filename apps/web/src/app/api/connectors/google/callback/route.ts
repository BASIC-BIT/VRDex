import { NextResponse, type NextRequest } from "next/server";
import type { GenericId } from "convex/values";

import { internal } from "@convex-generated-api";
import { appendReturnPathQuery, resolveSameOriginUrl } from "@/lib/return-path";
import { convexAuthToken, isUnauthenticatedError, unauthenticatedRedirectResponse, viewerQuery } from "@/lib/server/auth";
import { convexAdminHttpClient, convexHttpClient } from "@/lib/server/convex-http";
import {
  GOOGLE_CONNECTOR_CALLBACK_PATH, GOOGLE_CONNECTOR_STATE_COOKIE, errorCode, exchangeGoogleCode, integrationsPath, readStateCookie, stateCookieOptions,
} from "@/lib/server/google-connector-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  // The state is single-use whatever happens next.
  const finish = (response: NextResponse | Response) => {
    const next = response instanceof NextResponse ? response : new NextResponse(null, { status: response.status, headers: response.headers });
    next.cookies.set(GOOGLE_CONNECTOR_STATE_COOKIE, "", { ...stateCookieOptions, maxAge: 0 });
    return next;
  };
  const redirect = (path: string, query: Record<string, string | undefined> = {}) =>
    finish(NextResponse.redirect(resolveSameOriginUrl(appendReturnPathQuery(path, query), origin)));

  const pending = readStateCookie(request.cookies.get(GOOGLE_CONNECTOR_STATE_COOKIE)?.value, searchParams.get("state"));
  if (!pending) return redirect("/account", { googleCalendar: "failed" });
  const returnPath = integrationsPath(pending.communitySlug);
  const signIn = () => finish(unauthenticatedRedirectResponse(request, appendReturnPathQuery(returnPath, { googleCalendar: "failed" })));
  if (searchParams.get("error") === "access_denied") return redirect(returnPath);
  const code = searchParams.get("code");
  if (!code) return redirect(returnPath, { googleCalendar: "failed" });

  try {
    const token = await convexAuthToken();
    if (!token) return signIn();
    const client = convexHttpClient();
    client.setAuth(token);
    const actorUserId = (await client.query(viewerQuery, {}))?.user.id;
    if (!actorUserId) return signIn();
    const clientId = process.env.GOOGLE_CONNECTOR_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CONNECTOR_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("GOOGLE_CONNECTOR_CLIENT_MISSING");
    const grant = await exchangeGoogleCode({ code, redirectUri: origin + GOOGLE_CONNECTOR_CALLBACK_PATH, clientId, clientSecret });
    const connectorId = pending.connectorId as GenericId<"eventConnectors"> | undefined;
    const { credentialId } = await convexAdminHttpClient().action(internal.googleCalendarConnector.storeCredential, {
      actorUserId, communitySlug: pending.communitySlug, connectorId, ...grant,
    });
    return redirect(returnPath, connectorId ? {} : { googleCredential: credentialId });
  } catch (error) {
    if (isUnauthenticatedError(error)) return signIn();
    console.error(`Google Calendar connect failed: ${errorCode(error)}`);
    return redirect(returnPath, { googleCalendar: "failed" });
  }
}
