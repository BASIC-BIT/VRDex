import type { ReactNode } from "react";

/**
 * Blocks `/support` from session replay.
 *
 * Replay records every route and is kept safe by masking, but this is the one
 * page whose entire purpose is to collect a narrative: who someone is, which
 * account they lost, why a listing is really about them, and links to whatever
 * proves it. `maskAllInputs` does cover a textarea's value, so on today's markup
 * nothing leaks. That is the whole objection. Masking would be the only thing
 * standing between a replay session and an ownership dispute, and the moment
 * this page renders any of it back as text -- a review step, a confirmation
 * summary, an error quoting the input -- it leaks with nothing to catch it.
 *
 * Route-level on purpose, like `/claim` and `/developers`. Marking individual
 * elements is how four separate leaks reached review, each fix covering the
 * element reported while the next unmarked surface leaked identically.
 */
export default function SupportLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ph-no-capture" data-ph-no-capture>
      {children}
    </div>
  );
}
