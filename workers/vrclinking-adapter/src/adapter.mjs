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
// Convex abandons the adapter request at ten seconds. Stopping short of that
// keeps the fan-out inside the window whose answer can still be used.
const DEFAULT_FAN_OUT_BUDGET_MS = 8_000;

/**
 * Reject once the budget is spent, whatever the underlying work does.
 *
 * The AWS SDK carries its own retries and no cancellation seam here, so this
 * bounds how long the fan-out waits rather than the call itself. That is the
 * part that matters: a resolution nobody is waiting for cannot delay the next
 * delegation or outlive the caller's request.
 */
function withDeadline(work, remainingMs) {
  if (remainingMs <= 0) {
    return Promise.reject(
      new SecretResolutionError("Fan-out budget spent before resolution.", {
        reason: "resolution_timeout",
      }),
    );
  }

  let timer;

  return Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new SecretResolutionError("Secret resolution exceeded the fan-out budget.", {
              reason: "resolution_timeout",
            }),
          ),
        remainingMs,
      );
    }),
  ]);
}

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
  // One form, matching registration. The ARN form was accepted here too, and its
  // pattern allowed any region and any 12-digit account while this adapter's
  // execution role can read only its own — so it admitted references that could
  // never resolve.
  return secretRef === `secret://vrdex/vrclinking/${guildId}`;
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

  // Shape-checked before any byte comparison. A 64-character string of
  // non-ASCII produces a UTF-8 buffer of a different byte length, and
  // `timingSafeEqual` throws on that — out of `validateRequest`, which the
  // server calls outside its per-request `try`, so an authenticated caller
  // could take the process down with one malformed field.
  if (typeof capability !== "string" || !/^[a-f0-9]{64}$/.test(capability)) {
    return false;
  }

  if (typeof expiresAt !== "number") {
    return false;
  }

  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return false;
  }

  const expected = createHmac("sha256", key)
    .update(`${guildId}\n${secretRef}\n${expiresAt}`)
    .digest("hex");

  // Both are now known to be 64 hex characters, so the buffers match in length
  // and `timingSafeEqual` cannot throw.
  return timingSafeEqual(Buffer.from(capability), Buffer.from(expected));
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
  // Stamped before filtering, and reported instead of the position in the
  // filtered array. The control plane looks the returned index up in the batch
  // it *sent*, so any dropped entry shifted every later one: a match on the
  // second delegation came back as index 0, and Convex then re-checked and
  // stamped the first. If the credential that actually answered was revoked
  // mid-flight, the unrelated still-active row passed the re-check in its place
  // and the claim was granted on a revoked answer.
  const usable = delegations
    .map((delegation, requestIndex) => ({ delegation, requestIndex }))
    .filter(
      ({ delegation }) =>
        typeof delegation?.guildId === "string" &&
        DISCORD_SNOWFLAKE_PATTERN.test(delegation.guildId) &&
        typeof delegation?.secretRef === "string" &&
        isSecretRefForGuild(delegation.secretRef, delegation.guildId) &&
        verifyCapability(delegation),
    )
    .map(({ delegation, requestIndex }) => ({ ...delegation, requestIndex }));

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
export async function verifyLinkage({
  request,
  resolveSecret,
  getGuildMemberByDiscordId,
  // One end-to-end budget for the whole fan-out, shorter than the caller's
  // deadline. Each lookup carries its own timeout, so five slow delegations
  // could run well past the point Convex abandoned the request: the match in
  // the fifth could never arrive, and the provider quota of every community
  // after the caller gave up was spent for nothing.
  deadlineMs = DEFAULT_FAN_OUT_BUDGET_MS,
  now = () => Date.now(),
}) {
  const deadline = now() + deadlineMs;
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

  // `requestIndex`, not the loop position: `validateRequest` may have dropped
  // entries, and the control plane resolves every index it gets back against
  // the batch it sent.
  for (const delegation of request.delegations) {
    const index = delegation.requestIndex;
    // Out of budget. Reported as a failure rather than a silent stop: if
    // nothing was consulted this becomes `unavailable`, which is the honest
    // answer — "we ran out of time" is not "VRCLinking says no".
    if (now() >= deadline) {
      failures.push("fan_out_deadline");
      break;
    }

    let token;

    try {
      // Bounded too. Secrets Manager stalling or retrying is outside the
      // provider lookup's own deadline, so an unbounded resolution here ran
      // past the fan-out budget and past the caller's timeout, and the lookup
      // that followed spent provider quota on an answer nobody could receive.
      token = await withDeadline(resolveSecret(delegation.secretRef), deadline - now());
    } catch (error) {
      failures.push(
        error instanceof SecretResolutionError ? error.reason : "secret_resolution_failed",
      );
      continue;
    }

    // Re-checked after resolution, not only before it: a slow resolve can spend
    // the whole budget on its own, and the lookup below must not start on a
    // deadline that has already passed.
    if (now() >= deadline) {
      failures.push("fan_out_deadline");
      break;
    }

    let member;

    try {
      member = await getGuildMemberByDiscordId(delegation.guildId, request.discordUserId, token, {
        remainingMs: deadline - now(),
      });
    } catch (error) {
      const reason = error instanceof VrclinkingProviderError ? error.reason : "provider_error";

      // A rejected token, a rate limit, or a malformed payload all mean
      // VRCLinking received the request and answered it, so the key was
      // genuinely queried and the operator's "last queried" stamp should say
      // so. Only failures that never reached the provider — a network error, a
      // timeout, our own page cap — leave it untouched.
      if (
        error instanceof VrclinkingProviderError &&
        ["credential_rejected", "rate_limited", "provider_error", "schema_drift"].includes(reason)
      ) {
        consultedIndexes.push(index);
      }

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

    // The provider returned this exact member, so its attestation fields have
    // to be readable. A missing or non-boolean `isVerified`, or a `vrcId` that
    // is not a VRChat id, is schema drift — reporting it as a definitive
    // non-match would leave every check telling the claimant their link was not
    // found when the provider never made a usable statement about it.
    if (
      typeof member.isVerified !== "boolean" ||
      (member.isVerified && !VRCHAT_USER_ID_PATTERN.test(String(member.vrcId ?? "")))
    ) {
      failures.push("schema_drift");
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
