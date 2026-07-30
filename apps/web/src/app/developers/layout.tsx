import type { ReactNode } from "react";

/**
 * Blocks `/developers` from session replay.
 *
 * Replay records every route and is kept safe by masking, but `maskAllInputs`
 * covers input *values* only — not rendered text or `<option>` labels. The owner and application pickers list every owned claimed community without checking public readability, so a suppressed or opted-out community's name is rendered as option text.
 *
 * Route-level on purpose: marking individual elements is how four separate
 * leaks reached review, each fix covering the element reported while the next
 * unmarked surface leaked identically. `tests/web/session-replay-routes.test.ts`
 * pins the set of private route groups that must have one of these.
 */
export default function DevelopersLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ph-no-capture" data-ph-no-capture>
      {children}
    </div>
  );
}
