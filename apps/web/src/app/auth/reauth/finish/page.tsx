import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { ReauthFinishClient } from "./reauth-finish-client";
import { validRecentAuthChallengeId } from "@/lib/recent-auth";
import {
  decodeRecentAuthFinishProof,
  recentAuthFinishCookieIsSecure,
  recentAuthFinishCookieName,
} from "@/lib/server/recent-auth-binding";
import { validateSignInReturnTo } from "@/lib/safe-return-to";

export default async function ReauthFinishPage({
  searchParams,
}: {
  searchParams: Promise<{
    challenge?: string | string[];
    returnTo?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const returnTo = validateSignInReturnTo(params.returnTo);
  const challengeId = validRecentAuthChallengeId(params.challenge);
  if (challengeId === null) {
    redirect(returnTo);
  }
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const secureCookie = recentAuthFinishCookieIsSecure(
    requestHeaders.get("host"),
    requestHeaders.get("x-forwarded-proto"),
  );
  const proof = decodeRecentAuthFinishProof(
    cookieStore.get(
      recentAuthFinishCookieName(challengeId, secureCookie),
    )?.value,
    challengeId,
  );
  if (proof === null) {
    redirect(returnTo);
  }

  return (
    <ReauthFinishClient
      actionClass={proof.actionClass}
      challengeId={challengeId}
      returnTo={returnTo}
    />
  );
}
