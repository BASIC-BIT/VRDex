export type VrchatIdentityTargetType = "vrchat_user" | "vrchat_group";

const VRCHAT_USER_ID_PATTERN = /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VRCHAT_GROUP_ID_PATTERN = /^grp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeVrchatTargetId(
  value: string,
  targetType: VrchatIdentityTargetType,
): string | null {
  const trimmed = value.trim();
  let candidate = trimmed;

  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    candidate = segments[segments.length - 1] ?? "";
  } catch {
    // Raw VRChat ids are accepted.
  }

  const pattern = targetType === "vrchat_user" ? VRCHAT_USER_ID_PATTERN : VRCHAT_GROUP_ID_PATTERN;

  // Lower-cased, not just validated. The patterns accept either case but every
  // consumer compares `assetExternalId` as an exact string, so returning the
  // input verbatim let `USR_1a2b…` and `usr_1a2b…` become two proofs, two link
  // rows, and two picker entries for one VRChat account.
  return pattern.test(candidate) ? candidate.toLowerCase() : null;
}
