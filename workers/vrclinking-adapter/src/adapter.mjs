import { SecretResolutionError } from "./secret-resolver.mjs";
import { VrclinkingProviderError } from "./vrclinking-client.mjs";

// VRChat user ids are the only claim target this adapter attests.
const VRCHAT_USER_ID_PATTERN =
  /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Discord user and guild ids are both snowflakes.
const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;
// Bounds provider calls per request so one claim cannot fan out across every
// delegation VRDex holds.
const MAX_DELEGATIONS = 5;

/**
 * The one secret name a delegation for `guildId` may point at.
 *
 * Convex enforces this when an operator registers a delegation, but the bearer
 * token in front of this adapter is a single shared credential: a caller who
 * holds it can post straight here and skip that check entirely. Since the
 * deployment role can read every delegated tenant secret, an unbound reference
 * would let such a caller spend another community's VRCLinking key against a
 * guild of their choosing. The rule has to hold on both sides of the boundary,
 * so it is repeated rather than delegated — and the two must stay in step with
 * `isSecretRefForGuild` in `convex/vrclinkingCredentials.ts`.
 */
function isSecretRefForGuild(secretRef, guildId) {
  const name = `vrdex/vrclinking/${guildId}`;

  if (secretRef === `secret://${name}`) {
    return true;
  }

  // Secrets Manager appends a six-character suffix to the name in the ARN.
  return new RegExp(
    `^arn:aws:secretsmanager:[a-z0-9-]{1,32}:\\d{12}:secret:${name}(-[A-Za-z0-9]{6})?$`,
  ).test(secretRef);
}

export function validateRequest(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "invalid_body" };
  }

  if (body.targetType !== "vrclinking") {
    return { ok: false, error: "unsupported_target_type" };
  }

  if (typeof body.discordUserId !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(body.discordUserId)) {
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
      typeof delegation?.guildId === "string" &&
      DISCORD_SNOWFLAKE_PATTERN.test(delegation.guildId) &&
      typeof delegation?.secretRef === "string" &&
      isSecretRefForGuild(delegation.secretRef, delegation.guildId),
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
  // Whether any delegation was actually asked. One broken credential alongside
  // a working one is still a real answer, so it must not be reported as "we
  // could not consult anything".
  let consulted = false;

  for (const [index, delegation] of request.delegations.entries()) {
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
      const reason = error instanceof VrclinkingProviderError ? error.reason : "provider_error";

      // A rejected token is stale by definition. Leaving it cached makes a key
      // rotation take the full cache TTL to take effect, and every attempt in
      // that window burns the claimant's cooldown for nothing.
      if (reason === "credential_rejected") {
        resolveSecret.invalidate?.(delegation.secretRef);
      }

      failures.push(reason);
      continue;
    }

    consulted = true;

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
        // Index, not just the guild id: two communities may delegate for the
        // same guild, and the control plane must stamp the one that answered.
        matchedDelegationIndex: index,
        evidenceSummary: `VRCLinking reports a verified link for this Discord account in guild ${delegation.guildId}.`,
      };
    }
  }

  // Distinguish "we could not ask" from "we asked and the answer was no", so a
  // credential problem is not reported to the user as a failed claim.
  //
  // Unavailable means nothing could be asked at all. Any failure reason counts
  // rather than an allow-list, because a new reason must not silently become
  // "VRCLinking says no" — but a delegation that did answer makes the result a
  // real negative even if another credential alongside it was broken.
  const unavailable = failures.length > 0 && !consulted;

  return {
    verified: false,
    evidenceSource: "vrclinking",
    evidenceSummary: unavailable
      ? "VRCLinking could not be consulted for any delegated server."
      : "VRCLinking does not report a verified link for this Discord account.",
    ...(unavailable ? { unavailable: true } : {}),
  };
}
