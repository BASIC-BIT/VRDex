import { convexAuthNextjsMiddleware } from "@convex-dev/auth/nextjs/server";
import { type NextFetchEvent, type NextRequest, NextResponse } from "next/server";
import { apiV0PreflightResponse } from "../api-v0-cors";

const authMiddleware = process.env.NEXT_PUBLIC_CONVEX_URL
  ? convexAuthNextjsMiddleware()
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
