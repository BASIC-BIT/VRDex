import { internal } from "../../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../../convex/_generated/dataModel";

import { apiProblemResponse } from "@/lib/server/api-v0";
import { optionalConvexAdminHttpClient } from "@/lib/server/convex-http";
import {
  isVrclinkingSecretStoreConfigured,
  scheduleVrclinkingDelegationKeyDeletion,
} from "@/lib/server/vrclinking-secret-store";

export const dynamic = "force-dynamic";

/**
 * Retires delegated keys whose owners are never coming back for them.
 *
 * Every other cleanup path is driven by a request — a reservation sweeps its own
 * guild, a revoke settles what it cancels — and none of them run for someone who
 * revoked and then never touched delegations again. That is the shape of the one
 * leak that persists: a key written by a POST that died after a revoke had
 * already cancelled its reservation.
 *
 * Triggered by the Convex cron, which can hold the obligations but cannot reach
 * the secret store. The cron sends nothing but its bearer — the names are
 * claimed from Convex here — so the request body cannot decide what gets
 * deleted. Not a browser surface: no session, because there is no user in this
 * flow.
 */
export async function POST(request: Request) {
  const token = process.env.VRCLINKING_CLEANUP_TOKEN?.trim();
  const presented = request.headers.get("authorization")?.replace(/^Bearer /, "").trim();

  // Fail closed on an unset token rather than treating "no token configured" as
  // "no token required", which would leave this open on every deployment that
  // has not enabled the sweep.
  if (!token || presented !== token) {
    return apiProblemResponse({
      type: "about:blank",
      title: "Not authorized",
      status: 401,
      detail: "This endpoint is called by VRDex's own scheduled cleanup.",
    });
  }

  if (!isVrclinkingSecretStoreConfigured()) {
    return apiProblemResponse({
      type: "about:blank",
      title: "Cleanup is unavailable",
      status: 503,
      detail: "This deployment has no delegated-key store to clean up.",
    });
  }

  // Checked before anything is deleted, not after. There is no session in this
  // flow, so the admin credential is the only way to record what was retired —
  // and deleting first would leave the rows unretired, so the same already-gone
  // obligations would fill every daily batch and later live keys would never be
  // reached. Refusing up front leaves them queued instead.
  const admin = optionalConvexAdminHttpClient();

  if (admin === null) {
    return apiProblemResponse({
      type: "about:blank",
      title: "Cleanup is unavailable",
      status: 503,
      detail: "This deployment cannot record retirements, so it will not delete keys it cannot confirm.",
    });
  }

  // Asked for, not accepted. The names used to arrive in the request body, on
  // the reasoning that only the cron holds the bearer — which makes the bearer
  // the only thing standing between a caller and `DeleteSecret` on any
  // well-formed delegated-credential name they can spell, backed by no row at
  // all. Deriving them here means the worst a leaked bearer buys is running the
  // sweep that was going to run anyway.
  //
  // It also settles the credential up front: this is an authenticated admin call
  // and it happens before any deletion, so a token that is present but stale or
  // scoped to another deployment fails here, with the obligations still queued
  // and retryable, rather than after the keys are already gone.
  let obligations: { credentialId: string; secretName: string }[];

  try {
    obligations = await admin.mutation(
      internal.vrclinkingCredentials.claimOverdueSecretCleanups,
      {},
    );
  } catch {
    return apiProblemResponse({
      type: "about:blank",
      title: "Cleanup is unavailable",
      status: 503,
      detail: "This deployment cannot reach its backend to claim cleanup obligations.",
    });
  }

  // Only the ones that actually went. An unconfirmed row stays reportable and
  // the next sweep offers it again, which is the retry — the same contract every
  // other cleanup path here follows.
  const outcomes = await Promise.allSettled(
    obligations.map(async (row) => {
      await scheduleVrclinkingDelegationKeyDeletion(row.secretName);

      return row.credentialId as Id<"communityVrclinkingCredentials">;
    }),
  );
  const retired = outcomes.flatMap((outcome) =>
    outcome.status === "fulfilled" ? [outcome.value] : [],
  );

  if (retired.length > 0) {
    await admin.mutation(internal.vrclinkingCredentials.confirmSecretsRetiredAsServer, {
      credentialIds: retired,
    });
  }

  return Response.json(
    { retired: retired.length, attempted: obligations.length },
    { headers: { "cache-control": "no-store" } },
  );
}
