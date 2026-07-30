import type { ReactNode } from "react";

/**
 * Blocks `/time` from session replay.
 *
 * The parser echoes the user's expression back as a model-derived clarification
 * question, alternative interpretations, and a failure reason. The textarea is
 * masked; none of that rendered output is, because `maskAllInputs` covers input
 * *values* only.
 *
 * Route-level on purpose: marking individual elements is how five separate
 * leaks reached review, each fix covering the element reported while the next
 * unmarked surface leaked identically. `tests/web/session-replay-routes.test.ts`
 * pins the set of private route groups that must have one of these.
 */
export default function TimeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ph-no-capture" data-ph-no-capture>
      {children}
    </div>
  );
}
