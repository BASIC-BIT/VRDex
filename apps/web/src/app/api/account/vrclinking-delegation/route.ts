import { api } from "@convex-generated-api";
import { internal } from "../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";

import { apiProblemResponse } from "@/lib/server/api-v0";
import { claimErrorCode } from "@/lib/claim-errors";
import {
  convexAuthToken,
  isUnauthenticatedError,
  unauthenticatedResponse,
} from "@/lib/server/auth";
import { convexAdminHttpClient, convexHttpClient } from "@/lib/server/convex-http";
import {
  isVrclinkingSecretStoreConfigured,
  putVrclinkingDelegationKey,
  scheduleVrclinkingDelegationKeyDeletion,
} from "@/lib/server/vrclinking-secret-store";

export const dynamic = "force-dynamic";

// Long enough for any key VRCLinking issues, short enough that this is not a
// place to post a payload. The value is never echoed back.
const MAX_API_KEY_LENGTH = 4096;

function problem(status: 400 | 401 | 403 | 429 | 500 | 503, title: string, detail: string) {
  return apiProblemResponse({ type: "about:blank", title, status, detail });
}

/**
 * Accepts a community's VRCLinking API key, puts it in the operator secret
 * store, and activates the delegation that points at it.
 *
 * Three steps, and the middle one is the reason: `reserveCredential` creates
 * the row first so the key has a name of its own to be written under, the key
 * is written to that name, and only then does `activateCredential` retire the
 * delegation this one replaces. Nothing existing is touched until the new key
 * is provably in the store, so a Secrets Manager failure costs an unused
 * reservation rather than the community's working delegation.
 *
 * The key is in this process's memory and nowhere else it can be read back: not
 * in Convex, not in the response, not in a log line.
 */
export async function POST(request: Request) {
  const authToken = await convexAuthToken();

  if (authToken === undefined) {
    return problem(
      401,
      "Sign in required",
      "A signed-in VRDex account is required to delegate a VRCLinking key.",
    );
  }

  if (!isVrclinkingSecretStoreConfigured()) {
    return problem(
      503,
      "Delegation is unavailable",
      "This deployment cannot store delegated VRCLinking keys yet.",
    );
  }

  let body: Record<string, unknown>;

  try {
    const parsed: unknown = await request.json();
    body = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return problem(400, "Invalid JSON", "Send a JSON object when delegating a VRCLinking key.");
  }

  const profileSlug = String(body.profileSlug ?? "").trim();
  const guildId = String(body.guildId ?? "").trim();
  const apiKey = String(body.apiKey ?? "").trim();

  if (!profileSlug || !guildId) {
    return problem(400, "Invalid delegation", "A profile and a Discord server are both required.");
  }

  if (!apiKey) {
    return problem(400, "Invalid delegation", "Paste the VRCLinking API key for this server.");
  }

  if (apiKey.length > MAX_API_KEY_LENGTH) {
    return problem(400, "Invalid delegation", "That does not look like a VRCLinking API key.");
  }

  const convex = convexHttpClient();

  convex.setAuth(authToken);

  let reservation: {
    credentialId: string;
    secretName: string;
    abandoned: { credentialId: string; secretName: string }[];
  };

  try {
    reservation = await convex.mutation(api.vrclinkingCredentials.reserveCredential, {
      profileSlug,
      guildId,
    });
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return unauthenticatedResponse("/account/connections");
    }

    // Only a refusal is a 403. Mapping every failure to one told an authorized
    // owner that they lack a control proof whenever Convex was merely
    // unreachable, and sent them off to re-verify Discord for a problem
    // re-verifying cannot fix.
    const code = claimErrorCode(error);

    if (code === null) {
      return problem(
        503,
        "Delegation is unavailable",
        "VRDex could not reach its backend. Nothing changed; try again shortly.",
      );
    }

    // A time-based limit, not an authorization refusal. Re-verifying Discord
    // cannot clear it, so sending the owner off to do that is the one piece of
    // advice guaranteed not to work.
    if (code === "TOO_MANY_OPEN_PROOFS") {
      return problem(
        429,
        "Too many key changes",
        "That server's key has been replaced several times just now. Wait a few minutes and try again.",
      );
    }

    return problem(
      403,
      "Delegation not allowed",
      "You need a current proof that you control that Discord server before delegating its key.",
    );
  }

  // Keys belonging to reservations that died before activating — a request
  // killed between the write and the mutation leaves one. Convex reports them
  // but does not delete their rows, because the row id is the only thing the
  // name can be derived from: dropping it on a transient failure here would
  // lose the key permanently. Only the confirmed deletions are forgotten, so an
  // unconfirmed one is reported again by the next reservation, which is the
  // retry.
  const retired = await Promise.allSettled(
    reservation.abandoned.map(async (row) => {
      await scheduleVrclinkingDelegationKeyDeletion(row.secretName);

      return row.credentialId as Id<"communityVrclinkingCredentials">;
    }),
  );
  const forgettable = retired.flatMap((outcome) =>
    outcome.status === "fulfilled" ? [outcome.value] : [],
  );

  if (forgettable.length > 0) {
    await convex
      .mutation(api.vrclinkingCredentials.confirmSecretsRetired, {
        profileSlug,
        credentialIds: forgettable,
      })
      .catch(() => undefined);
  }

  /**
   * Retire the key just written, but only once its row is known not to be live.
   *
   * `abandonCredential` deletes a `pending` row and refuses anything else, so
   * its answer *is* the question worth asking: a confirmed delete proves the
   * activation never committed, which is the only state where this key is
   * unreachable and safe to remove.
   *
   * Without that check, an activation that committed and lost its response
   * would look identical to one that failed — and deleting there would revoke
   * the previous delegation and then destroy the key that replaced it. Leaving
   * an orphan is the safe end of that trade, so an unreadable backend leaves
   * the secret alone.
   */
  async function discardStoredKey() {
    const credentialId = reservation.credentialId as Id<"communityVrclinkingCredentials">;
    // The session first, then the server. An expiry between storing the key and
    // activating it is the very case cleanup exists for, and it also makes the
    // session-authorized path fail — so the fallback is authorized by the
    // deployment rather than by the browser that has just lost its session. It
    // can only ever act on the reservation this request made.
    const abandoned: { abandoned: boolean; missing?: boolean; secretName?: string | null } =
      await convex
        .mutation(api.vrclinkingCredentials.abandonCredential, { profileSlug, credentialId })
        .catch(() =>
          convexAdminHttpClient()
            .mutation(internal.vrclinkingCredentials.abandonCredentialAsServer, { credentialId })
            .catch(() => ({ abandoned: false, missing: false })),
        );

    // A revoke can race this request: it cancels the reservation, retires the
    // name — reporting success, because the write had not landed yet — and
    // deletes the row. This request then finishes writing a key that nothing
    // points at. Its own name is per-credential and therefore unshared, so it is
    // always safe to retire, and this request is the only thing left holding it.
    // Should now be unreachable on the revoke race, since confirmation stamps
    // rows rather than deleting them — a cancelled reservation survives as a
    // tombstone and is found above. Kept for a row that is genuinely gone, and
    // the failure is not swallowed: without a row there is nothing to retry
    // from, so it is the owner's error to see.
    if (abandoned.missing) {
      await scheduleVrclinkingDelegationKeyDeletion(reservation.secretName);

      return;
    }

    // A null name means another profile's live delegation still resolves through
    // it, so there is nothing here to delete — the row is already claimed.
    if (!abandoned.abandoned || !abandoned.secretName) {
      return;
    }

    // Key first, row second. `abandonCredential` reports without deleting, so a
    // Secrets Manager failure here leaves the reservation in place and the next
    // reservation for this guild reports it again — the same retry the swept and
    // revoked paths get. Deleting the row first would destroy the only thing the
    // name can be derived from.
    const retired = await scheduleVrclinkingDelegationKeyDeletion(abandoned.secretName).then(
      () => true,
      () => false,
    );

    if (retired) {
      await convex
        .mutation(api.vrclinkingCredentials.confirmSecretsRetired, {
          profileSlug,
          credentialIds: [credentialId],
        })
        .catch(() =>
          convexAdminHttpClient()
            .mutation(internal.vrclinkingCredentials.confirmSecretsRetiredAsServer, {
              credentialIds: [credentialId],
            })
            .catch(() => undefined),
        );
    }
  }

  try {
    await putVrclinkingDelegationKey(reservation.secretName, apiKey);
  } catch {
    await discardStoredKey();

    return problem(
      500,
      "Delegation failed",
      "The key could not be stored. Nothing changed; try again.",
    );
  }

  try {
    const result = await convex.mutation(api.vrclinkingCredentials.activateCredential, {
      profileSlug,
      credentialId: reservation.credentialId as Id<"communityVrclinkingCredentials">,
    });

    // The keys this replaced. Their rows are revoked and their names are never
    // reused, so nothing can reach them again — retaining a community's live
    // provider credential after it has been replaced is the thing to avoid.
    //
    // Confirmed, not fire-and-forget: without it every replaced row stayed an
    // outstanding obligation, so each later reservation for the guild reported
    // and rescheduled keys that were already gone, and the recorded retirement
    // state never caught up.
    const supersededOutcomes = await Promise.allSettled(
      result.supersededSecretNames.map(async (name: string) => {
        await scheduleVrclinkingDelegationKeyDeletion(name);

        return name;
      }),
    );
    const retiredNames = new Set(
      supersededOutcomes.flatMap((outcome) =>
        outcome.status === "fulfilled" ? [outcome.value] : [],
      ),
    );
    const retiredIds = result.supersededCredentials
      .filter((row: { secretName: string }) => retiredNames.has(row.secretName))
      .map((row: { credentialId: string }) => row.credentialId as Id<"communityVrclinkingCredentials">);

    if (retiredIds.length > 0) {
      await convex
        .mutation(api.vrclinkingCredentials.confirmSecretsRetired, {
          profileSlug,
          credentialIds: retiredIds,
        })
        .catch(() => undefined);
    }

    return Response.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    // Cleanup first: an expired session is exactly the case where this used to
    // return without it, leaving the community's live key stored under a name
    // nothing points at.
    await discardStoredKey();

    if (isUnauthenticatedError(error)) {
      return unauthenticatedResponse("/account/connections");
    }

    // The previous delegation is still active and still points at its own
    // secret, which this never touched — so the owner is where they started
    // rather than worse off.
    return problem(
      500,
      "Delegation failed",
      "The key was stored but the delegation could not be activated. Try again.",
    );
  }
}

/**
 * Revoke a delegation and retire the key behind it.
 *
 * Routed through here rather than straight to Convex for the same reason the
 * write is: revoking the row does not remove the key, and per-credential names
 * are never reused — so an owner pressing Revoke would otherwise leave their
 * live provider credential in the store indefinitely, still readable by the
 * adapter role. Convex cannot reach Secrets Manager; this can.
 */
export async function DELETE(request: Request) {
  const authToken = await convexAuthToken();

  if (authToken === undefined) {
    return problem(
      401,
      "Sign in required",
      "A signed-in VRDex account is required to revoke a VRCLinking key.",
    );
  }

  let body: Record<string, unknown>;

  try {
    const parsed: unknown = await request.json();
    body = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return problem(400, "Invalid JSON", "Send a JSON object when revoking a VRCLinking key.");
  }

  const profileSlug = String(body.profileSlug ?? "").trim();
  const guildId = String(body.guildId ?? "").trim();

  if (!profileSlug || !guildId) {
    return problem(400, "Invalid request", "A profile and a Discord server are both required.");
  }

  const convex = convexHttpClient();

  convex.setAuth(authToken);

  let result: {
    revoked: boolean;
    credentialId: string | null;
    retired: { credentialId: string; secretName: string }[];
  };

  try {
    result = await convex.mutation(api.vrclinkingCredentials.revokeCredential, {
      profileSlug,
      guildId,
    });
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return unauthenticatedResponse("/account/connections");
    }

    if (claimErrorCode(error) === null) {
      return problem(
        503,
        "Revoke is unavailable",
        "VRDex could not reach its backend. Nothing changed; try again shortly.",
      );
    }

    return problem(403, "Revoke not allowed", "You do not manage that profile.");
  }

  // The row is revoked either way — the delegation is inert the moment it is,
  // and reversing an intended revocation because cleanup failed would be worse.
  // But the obligation is *kept*: Convex marks the row retired only on
  // confirmation, and an unconfirmed one is reported again by the next
  // reservation for that guild. Revoking makes the row invisible to this path,
  // which looks for an active row, so without that the owner's live key would
  // stay in the store with no retry anywhere.
  if (result.retired.length > 0 && isVrclinkingSecretStoreConfigured()) {
    // Every row this revoke retired, which includes reservations it cancelled: a
    // replacement that wrote its key and then crashed has no request left to
    // clean itself up, and after a revocation there may never be another
    // reservation for this guild to sweep it.
    const outcomes = await Promise.allSettled(
      result.retired.map(async (row) => {
        await scheduleVrclinkingDelegationKeyDeletion(row.secretName);

        return row.credentialId as Id<"communityVrclinkingCredentials">;
      }),
    );
    const confirmed = outcomes.flatMap((outcome) =>
      outcome.status === "fulfilled" ? [outcome.value] : [],
    );

    if (confirmed.length > 0) {
      await convex
        .mutation(api.vrclinkingCredentials.confirmSecretsRetired, {
          profileSlug,
          credentialIds: confirmed,
        })
        .catch(() => undefined);
    }
  }

  return Response.json(result, { headers: { "cache-control": "private, no-store" } });
}
