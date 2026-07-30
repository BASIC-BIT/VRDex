import { clerkMiddleware } from "@clerk/nextjs/server";
import { type NextFetchEvent, type NextRequest, NextResponse } from "next/server";
import { apiV0PreflightResponse } from "../api-v0-cors";
import {
  hasE2eSubmitBypass,
  isProtectedRoute,
  protectedRouteSignInPath,
} from "./lib/protected-route-redirect";

const authMiddleware = process.env.NEXT_PUBLIC_CONVEX_URL
  ? clerkMiddleware(async (auth, request) => {
      const { pathname, search } = request.nextUrl;
      const allowFixtureDemos =
        process.env.NODE_ENV !== "production" &&
        process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES === "true";

      if (!isProtectedRoute(pathname, { allowFixtureDemos })) {
        return NextResponse.next();
      }

      const expectedE2eToken = process.env.VRDEX_E2E_BROWSER_TOKEN?.trim();
      const requestE2eToken = request.cookies.get("vrdex_e2e_token")?.value;

      if (
        hasE2eSubmitBypass({
          pathname,
          helpersEnabled: process.env.VRDEX_ENABLE_E2E_HELPERS === "true",
          expectedToken: expectedE2eToken,
          requestToken: requestE2eToken,
        })
      ) {
        return NextResponse.next();
      }

      // Clerk is the session authority, so an unauthenticated request here has
      // no token, an expired one, or one for a revoked session — all the same
      // outcome, and no session record to consult.
      const { isAuthenticated } = await auth();

      if (!isAuthenticated) {
        return NextResponse.redirect(
          new URL(protectedRouteSignInPath(pathname, search), request.url),
        );
      }

      return NextResponse.next();
    })
  : function middleware() {
      return NextResponse.next();
    };

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  const preflightResponse = apiV0PreflightResponse(request);

  if (preflightResponse !== null) {
    return preflightResponse;
  }

  return authMiddleware(request, event);
}

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
