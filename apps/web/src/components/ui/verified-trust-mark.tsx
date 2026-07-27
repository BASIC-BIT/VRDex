import { cn } from "@/lib/cn";

export function VerifiedTrustMark({
  className,
  label = "Verified profile",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      aria-label={label}
      className={cn("verified-trust-mark", className)}
      role="img"
      title={label}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <path
          d="m4.1 8.3 2.45 2.45L12.25 5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
    </span>
  );
}
