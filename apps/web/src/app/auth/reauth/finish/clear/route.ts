import { clearRecentAuthFinishCookie } from "@/lib/server/recent-auth-binding";
import { validRecentAuthChallengeId } from "@/lib/recent-auth";
import { validateSignInReturnTo } from "@/lib/safe-return-to";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo = validateSignInReturnTo(
    requestUrl.searchParams.get("returnTo"),
  );
  const challengeId = validRecentAuthChallengeId(
    requestUrl.searchParams.get("challenge"),
  );

  return clearRecentAuthFinishCookie(
    new Response(null, {
      status: 303,
      headers: {
        "cache-control": "private, no-store",
        location: returnTo,
      },
    }),
    request,
    challengeId,
  );
}
