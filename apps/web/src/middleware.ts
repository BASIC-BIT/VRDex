import {
  convexAuthNextjsMiddleware,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { type NextFetchEvent, type NextRequest, NextResponse } from "next/server";
import { apiV0PreflightResponse } from "../api-v0-cors";
import {
  hasE2eSubmitBypass,
  isProtectedRoute,
  protectedRouteSignInPath,
} from "./lib/protected-route-redirect";
import { AUTH_SESSION_COOKIE_MAX_AGE_SECONDS } from "./lib/auth-session";

const authMiddleware = process.env.NEXT_PUBLIC_CONVEX_URL
  ? convexAuthNextjsMiddleware(
      async (request, { convexAuth }) => {
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

        if (!(await convexAuth.isAuthenticated())) {
          return nextjsMiddlewareRedirect(
            request,
            protectedRouteSignInPath(pathname, search),
          );
        }

        return NextResponse.next();
      },
      {
        cookieConfig: {
          maxAge: AUTH_SESSION_COOKIE_MAX_AGE_SECONDS,
        },
      },
    )
  : function middleware() {
      return NextResponse.next();
    };

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  const preflightResponse = apiV0PreflightResponse(request);

  if (preflightResponse !== null) {
    return preflightResponse;
  }

  if (
    request.nextUrl.pathname === "/auth/reauth/complete" ||
    request.nextUrl.pathname === "/auth/reauth/fail" ||
    request.nextUrl.pathname === "/auth/session-converge"
  ) {
    return NextResponse.next();
  }

  return authMiddleware(request, event);
}

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
