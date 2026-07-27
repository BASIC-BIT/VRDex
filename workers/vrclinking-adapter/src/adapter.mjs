import { SecretResolutionError } from "./secret-resolver.mjs";
import { VrclinkingProviderError } from "./vrclinking-client.mjs";

// VRChat user ids are the only claim target this adapter attests.
const VRCHAT_USER_ID_PATTERN =
  /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISCORD_USER_ID_PATTERN = /^\d{17,20}$/;
// Bounds provider calls per request so one claim cannot fan out across every
// delegation VRDex holds.
const MAX_DELEGATIONS = 5;

export function validateRequest(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "invalid_body" };
  }

  if (body.targetType !== "vrclinking") {
    return { ok: false, error: "unsupported_target_type" };
  }

  if (typeof body.discordUserId !== "string" || !DISCORD_USER_ID_PATTERN.test(body.discordUserId)) {
    return { ok: false, error: "invalid_discord_user_id" };
  }

  if (
    typeof body.targetExternalId !== "string" ||
    !VRCHAT_USER_ID_PATTERN.test(body.targetExternalId)
  ) {
    return { ok: false, error: "invalid_target_external_id" };
  }

  const delegations = Array.isArray(body.delegations) ? body.delegations : [];
  const usable = delegations.filter(
    (delegation) =>
      typeof delegation?.guildId === "string" && typeof delegation?.secretRef === "string",
  );

  if (usable.length === 0) {
    return { ok: false, error: "no_delegations" };
  }

  return {
    ok: true,
    request: {
      discordUserId: body.discordUserId,
      targetExternalId: body.targetExternalId,
      delegations: usable.slice(0, MAX_DELEGATIONS),
    },
  };
}

/**
 * Ask each delegated guild whether VRCLinking reports the Discord user as
 * linked to the claimed VRChat account.
 *
 * A match requires an exact `vrcId` equality *and* `isVerified`, so an
 * unverified or mismatched link never attests ownership. Provider text and the
 * member's other fields are deliberately not echoed back: the control plane
 * receives a boolean and a summary naming only the guild.
 */
export async function verifyLinkage({ request, resolveSecret, getGuildMemberByDiscordId }) {
  const failures = [];

  for (const delegation of request.delegations) {
    let token;

    try {
      token = await resolveSecret(delegation.secretRef);
    } catch (error) {
      failures.push(
        error instanceof SecretResolutionError ? error.reason : "secret_resolution_failed",
      );
      continue;
    }

    let member;

    try {
      member = await getGuildMemberByDiscordId(delegation.guildId, request.discordUserId, token);
    } catch (error) {
      failures.push(
        error instanceof VrclinkingProviderError ? error.reason : "provider_error",
      );
      continue;
    }

    if (member === null || member === undefined) {
      continue;
    }

    if (member.isVerified === true && member.vrcId === request.targetExternalId) {
      return {
        verified: true,
        evidenceSource: "vrclinking",
        // Naming the matching guild lets the control plane stamp only the
        // delegation that actually answered, instead of every one consulted.
        matchedGuildId: delegation.guildId,
        evidenceSummary: `VRCLinking reports a verified link for this Discord account in guild ${delegation.guildId}.`,
      };
    }
  }

  // Distinguish "we could not ask" from "we asked and the answer was no", so a
  // credential problem is not reported to the user as a failed claim.
  const unavailable = failures.some((reason) =>
    ["credential_rejected", "rate_limited", "provider_error", "timeout", "network", "not_found", "unsupported_reference"].includes(
      reason,
    ),
  );

  return {
    verified: false,
    evidenceSource: "vrclinking",
    evidenceSummary: unavailable
      ? "VRCLinking could not be consulted for any delegated server."
      : "VRCLinking does not report a verified link for this Discord account.",
    ...(unavailable ? { unavailable: true } : {}),
  };
}
