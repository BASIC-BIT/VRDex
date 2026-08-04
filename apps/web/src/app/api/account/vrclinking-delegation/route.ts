import { api } from "@convex-generated-api";

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
} from "@/lib/server/vrclinking-secret-store";

export const dynamic = "force-dynamic";

// Long enough for any key VRCLinking issues, short enough that this is not a
// place to post a payload. The value is never echoed back.
const MAX_API_KEY_LENGTH = 4096;

function problem(status: 400 | 401 | 403 | 500 | 503, title: string, detail: string) {
  return apiProblemResponse({ type: "about:blank", title, status, detail });
}

/**
 * Accepts a community's VRCLinking API key and puts it in the operator secret
 * store, then records the delegation in Convex.
 *
 * The order matters and is not the obvious one. Convex authorizes first through
 * `canDelegateForGuild`, the key is written second, and the delegation is
 * registered last — because registering revokes whatever delegation the
 * community had before it. Registering first would mean a failed secret write
 * left them with no working delegation where they started with one.
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

  try {
    await convex.query(api.vrclinkingCredentials.canDelegateForGuild, { profileSlug, guildId });
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
    await putVrclinkingDelegationKey(guildId, apiKey);
  } catch {
    return problem(
      500,
      "Delegation failed",
      "The key could not be stored. Nothing changed; try again.",
    );
  }

  try {
    const result = await convex.mutation(api.vrclinkingCredentials.registerCredential, {
      profileSlug,
      guildId,
    });

    return Response.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return unauthenticatedResponse("/account/connections");
    }

    return problem(
      500,
      "Delegation failed",
      "The key was stored but the delegation could not be recorded. Try again.",
    );
  }
}
