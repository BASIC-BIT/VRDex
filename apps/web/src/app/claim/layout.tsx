import type { ReactNode } from "react";

/**
 * Blocks `/claim` from session replay.
 *
 * Replay records every route and is kept safe by masking, but `maskAllInputs`
 * covers input *values* only — not rendered text or `<option>` labels. A claim page carries the one-time proof code, the target ids, and — for a draft, opted-out, or suppressed listing — an identity nobody outside the account can see.
 *
 * Route-level on purpose: marking individual elements is how four separate
 * leaks reached review, each fix covering the element reported while the next
 * unmarked surface leaked identically. `tests/web/session-replay-routes.test.ts`
 * pins the set of private route groups that must have one of these.
 */
export default function ClaimLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ph-no-capture" data-ph-no-capture>
      {children}
    </div>
  );
}
