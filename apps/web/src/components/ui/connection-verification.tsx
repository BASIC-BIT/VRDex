import { VerifiedTrustMark } from "./verified-trust-mark";
import { formatVerificationDate } from "@/lib/profile-link-verification";

export function ConnectionVerification({ at, group = false }: { at: number; group?: boolean }) {
  const label = group ? "Verified VRChat group" : "Verified VRChat account";
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-normal text-muted">
      <VerifiedTrustMark label={label} />
      <span>{label}</span>
      <time dateTime={new Date(at).toISOString()}>{formatVerificationDate(at)}</time>
    </span>
  );
}
