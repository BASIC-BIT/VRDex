import { createHmac, timingSafeEqual } from "node:crypto";

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
 * A shape check, not an authorization one — the names are derived from the
 * guild id, so a caller who reaches this endpoint constructs a matching pair as
 * easily as VRDex does. It stays because it rejects malformed and traversal
 * references cheaply; the authorization is `verifyCapability` below.
 *
 * Must stay in step with `isSecretRefForGuild` in
 * `convex/vrclinkingCredentials.ts`.
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

/**
 * Whether VRDex actually authorized this delegation for this request.
 *
 * The shared bearer token in front of this adapter authenticates the channel,
 * not the request: once it leaks, a caller can name any guild, and the
 * name-shape check above cannot tell them apart from VRDex. The capability is
 * signed with a key the bearer token does not carry, so a direct caller cannot
 * construct one — and it expires, so a captured request is worth minutes rather
 * than until the key rotates.
 *
 * Must stay in step with `convex/_delegationCapability.ts`, which mints these.
 */
export function verifyCapability(delegation, { now = Date.now(), key = capabilityKey() } = {}) {
  const { guildId, secretRef, expiresAt, capability } = delegation;

  if (typeof capability !== "string" || typeof expiresAt !== "number") {
    return false;
  }

  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return false;
  }

  const expected = createHmac("sha256", key)
    .update(`${guildId}\n${secretRef}\n${expiresAt}`)
    .digest("hex");

  // Length-checked first: `timingSafeEqual` throws on a mismatch rather than
  // returning false.
  return (
    capability.length === expected.length &&
    timingSafeEqual(Buffer.from(capability), Buffer.from(expected))
  );
}

function capabilityKey() {
  const value = process.env.VRDEX_VRCLINKING_CAPABILITY_KEY?.trim();

  // Required, and never defaulted. An adapter that accepts unsigned
  // delegations is the state this exists to prevent, and a check that
  // disappears when a variable is unset looks enforced in review and is not in
  // production.
  if (!value) {
    throw new Error("VRDEX_VRCLINKING_CAPABILITY_KEY must be set.");
  }

  return value;
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
      isSecretRefForGuild(delegation.secretRef, delegation.guildId) &&
      verifyCapability(delegation),
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
  // Which delegations were actually asked. The control plane stamps an
  // operator-visible "last queried" from this, so guessing — every selected
  // delegation, stamped before the request — wrote audit history for keys that
  // were never tested, and hid keys that never had been.
  const consultedIndexes = [];
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
    consultedIndexes.push(index);

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
        consultedDelegationIndexes: consultedIndexes,
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
    consultedDelegationIndexes: consultedIndexes,
    ...(unavailable ? { unavailable: true } : {}),
  };
}
