// Proof-code matching for VRChat ownership verification.
//
// This module is deliberately pure and returns booleans only. Profile bios and
// group descriptions are read to look for a one-time code and are never
// returned, stored, or logged by the collector — the control plane learns only
// whether the code was present.

const PROOF_CODE_PATTERN = /^VRDEX-[A-Z0-9]{6,32}$/;

/**
 * VRChat surfaces the code inside free text a user may have styled, wrapped, or
 * surrounded with punctuation, so compare on an alphanumeric-only projection
 * rather than requiring an exact substring.
 */
export function normalizeProofText(value) {
  return typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

export function isValidProofCode(proofCode) {
  return typeof proofCode === "string" && PROOF_CODE_PATTERN.test(proofCode);
}

/**
 * True when `proofCode` appears in any of `candidates`.
 *
 * Rejects malformed codes rather than matching them, so an empty or truncated
 * code can never verify against arbitrary text.
 */
export function containsProofCode(candidates, proofCode) {
  if (!isValidProofCode(proofCode)) {
    return false;
  }

  const needle = normalizeProofText(proofCode);

  if (needle.length === 0) {
    return false;
  }

  return (Array.isArray(candidates) ? candidates : [candidates]).some((candidate) =>
    normalizeProofText(candidate).includes(needle),
  );
}

/** Fields that may carry a proof code, by target type. */
export function proofSurfaceFields(targetType) {
  return targetType === "vrchat_group"
    ? ["description", "name"]
    : ["bio", "statusDescription"];
}
