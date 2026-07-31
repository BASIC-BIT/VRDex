import { auth } from "@clerk/nextjs/server";
import { makeFunctionReference } from "convex/server";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { validateSignInReturnTo } from "../safe-return-to";

export const UNAUTHENTICATED_CODE = "UNAUTHENTICATED";

/**
 * Server-side Convex credential, replacing Convex Auth's own token helper. The
 * template name must match the `convex` JWT template on the Clerk instance and
 * the `applicationID` in `convex/auth.config.ts`.
 */
export async function convexAuthToken() {
  // `auth()` throws when `clerkMiddleware` did not run, which is the case in
  // environments with no Clerk credentials because the middleware is gated on
  // them. Callers already treat `undefined` as unauthenticated and answer 401,
  // so failing closed here beats surfacing a Clerk configuration error.
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return undefined;
  }

  const { getToken } = await auth();

  return (await getToken({ template: "convex" })) ?? undefined;
}

type Viewer = {
  user: {
    id: Id<"users">;
    name?: string;
    email?: string;
    emailVerified: boolean;
    image?: string;
  };
} | null;

export const viewerQuery = makeFunctionReference<
  "query",
  Record<string, never>,
  Viewer
>("accounts:viewer");

const ensureCurrentUserMutation = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { id: Id<"users"> }
>("users:ensureCurrentUser");

/**
 * Resolves the viewer for a server route, provisioning the `users` row first.
 *
 * The client-side effect that normally provisions has not necessarily run: a
 * brand-new Clerk identity can be redirected straight into a server route — the
 * OAuth authorize endpoint being the case that matters — where a missing row
 * would read as "not signed in" and bounce back to sign-in indefinitely.
 *
 * `ensureCurrentUser` is idempotent and skips the write when nothing changed, so
 * calling it on this path costs an indexed lookup rather than a write.
 */
export async function ensureViewer(client: {
  mutation: (reference: typeof ensureCurrentUserMutation, args: Record<string, never>) => Promise<{ id: Id<"users"> }>;
  query: (reference: typeof viewerQuery, args: Record<string, never>) => Promise<Viewer>;
}): Promise<Viewer> {
  await client.mutation(ensureCurrentUserMutation, {});

  return await client.query(viewerQuery, {});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * True for either code meaning "this request is not signed in".
 *
 * Convex's `requireClaimSession` maps `_identity`'s `UNAUTHENTICATED` to the
 * browser-facing `SIGN_IN_REQUIRED`, so a route that only recognised the former
 * would miss every claim-path failure — the Discord callback in particular,
 * which uses this to decide whether to return the user through sign-in with
 * their `returnTo` intact rather than dropping them on a generic failure.
 */
export function isUnauthenticatedError(error: unknown) {
  return (
    isRecord(error) &&
    isRecord(error.data) &&
    (error.data.code === UNAUTHENTICATED_CODE ||
      error.data.code === "SIGN_IN_REQUIRED")
  );
}

export function signInPath(returnTo: string) {
  return `/sign-in?returnTo=${encodeURIComponent(validateSignInReturnTo(returnTo))}`;
}

/**
 * Clerk owns the session cookies, so unlike the Convex Auth version these no
 * longer expire anything — a request that fails to authenticate simply has no
 * usable token, and Clerk clears its own cookies on sign-out or revocation.
 */
export function unauthenticatedResponse(returnTo: string) {
  return Response.json(
    {
      code: UNAUTHENTICATED_CODE,
      detail: "Sign in to continue.",
      signInUrl: signInPath(returnTo),
      status: 401,
      title: "Sign in required",
      type: "about:blank",
    },
    { status: 401, headers: { "cache-control": "private, no-store" } },
  );
}

/**
 * Browser-navigation counterpart to `unauthenticatedResponse`. Routes the user
 * follows a link into — the Discord OAuth start and callback — must redirect
 * rather than answer with raw JSON.
 */
export function unauthenticatedRedirectResponse(
  request: Request,
  returnTo?: string,
) {
  const requestUrl = new URL(request.url);
  const target = signInPath(
    returnTo ?? requestUrl.searchParams.get("returnTo") ?? "/account",
  );

  return new Response(null, {
    status: 303,
    headers: {
      "cache-control": "private, no-store",
      location: new URL(target, requestUrl).toString(),
    },
  });
}
