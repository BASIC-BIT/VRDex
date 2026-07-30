import { clerkMiddleware } from "@clerk/nextjs/server";
import { type NextFetchEvent, type NextRequest, NextResponse } from "next/server";
import { apiV0PreflightResponse } from "../api-v0-cors";
import {
  hasE2eSubmitBypass,
  isProtectedRoute,
  protectedRouteSignInPath,
} from "./lib/protected-route-redirect";

const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function protectedRouteDecision(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const allowFixtureDemos =
    process.env.NODE_ENV !== "production" &&
    process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES === "true";

  if (!isProtectedRoute(pathname, { allowFixtureDemos })) {
    return "allow" as const;
  }

  if (
    hasE2eSubmitBypass({
      pathname,
      helpersEnabled: process.env.VRDEX_ENABLE_E2E_HELPERS === "true",
      expectedToken: process.env.VRDEX_E2E_BROWSER_TOKEN?.trim(),
      requestToken: request.cookies.get("vrdex_e2e_token")?.value,
    })
  ) {
    return "allow" as const;
  }

  return "guard" as const;
}

function redirectToSignIn(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  return NextResponse.redirect(
    new URL(protectedRouteSignInPath(pathname, search), request.url),
  );
}

const authMiddleware = !convexConfigured
  ? // Nothing to authenticate against, and this is the pre-existing behaviour for
    // Convex-less builds. Left as a pass-through so those keep rendering.
    function middleware() {
      return NextResponse.next();
    }
  : clerkConfigured
  ? clerkMiddleware(async (auth, request) => {
      if (protectedRouteDecision(request) === "allow") {
        return NextResponse.next();
      }

      // Clerk is the session authority, so an unauthenticated request here has
      // no token, an expired one, or one for a revoked session — all the same
      // outcome, and no session record to consult.
      const { isAuthenticated } = await auth();

      return isAuthenticated ? NextResponse.next() : redirectToSignIn(request);
    })
  : // No Clerk credentials means no session can ever be established, so every
    // protected route redirects to sign-in. `clerkMiddleware` is skipped because
    // `auth()` would throw, but the routes stay closed rather than opening up —
    // an unconfigured deployment must not serve account pages to anonymous
    // visitors just because it cannot evaluate a session.
    function middleware(request: NextRequest) {
      return protectedRouteDecision(request) === "allow"
        ? NextResponse.next()
        : redirectToSignIn(request);
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
