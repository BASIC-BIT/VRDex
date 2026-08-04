import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";

import { apiProblemResponse } from "@/lib/server/api-v0";
import {
  convexAuthToken,
  isUnauthenticatedError,
  unauthenticatedResponse,
} from "@/lib/server/auth";
import { convexHttpClient } from "@/lib/server/convex-http";
import {
  isVrclinkingSecretStoreConfigured,
  putVrclinkingDelegationKey,
  scheduleVrclinkingDelegationKeyDeletion,
} from "@/lib/server/vrclinking-secret-store";

export const dynamic = "force-dynamic";

// Long enough for any key VRCLinking issues, short enough that this is not a
// place to post a payload. The value is never echoed back.
const MAX_API_KEY_LENGTH = 4096;

function problem(status: 400 | 401 | 403 | 500 | 503, title: string, detail: string) {
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

  let reservation: { credentialId: string; secretName: string };

  try {
    reservation = await convex.mutation(api.vrclinkingCredentials.reserveCredential, {
      profileSlug,
      guildId,
    });
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return unauthenticatedResponse("/account/connections");
    }

    return problem(
      403,
      "Delegation not allowed",
      "You need a current proof that you control that Discord server before delegating its key.",
    );
  }

  try {
    await putVrclinkingDelegationKey(reservation.secretName, apiKey);
  } catch {
    // Best effort: the reservation is inert either way — nothing selects a
    // pending row, and `reserveCredential` sweeps abandoned ones — so a failure
    // here is not worth reporting over the one the owner actually hit.
    await convex
      .mutation(api.vrclinkingCredentials.abandonCredential, {
        profileSlug,
        credentialId: reservation.credentialId as Id<"communityVrclinkingCredentials">,
      })
      .catch(() => undefined);

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

    return Response.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return unauthenticatedResponse("/account/connections");
    }

    // The key that was just written is now unreachable: its name belongs to a
    // reservation that will be swept, and names are never reused. Retire it
    // rather than retaining a community's live credential for nothing. Both
    // calls are best effort — the owner's error is the one worth reporting.
    await Promise.allSettled([
      scheduleVrclinkingDelegationKeyDeletion(reservation.secretName),
      convex.mutation(api.vrclinkingCredentials.abandonCredential, {
        profileSlug,
        credentialId: reservation.credentialId as Id<"communityVrclinkingCredentials">,
      }),
    ]);

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
