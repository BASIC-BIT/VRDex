import type { ReactNode } from "react";

/**
 * Blocks `/events` from session replay.
 *
 * Everything under here is authoring — `/events/new` and `/events/[slug]/edit`;
 * the public event page is `/e/[slug]`. The editor renders private VRCDN output
 * accounts and worker status as `<option>` labels and body text, and
 * `maskAllInputs` covers input *values* only.
 *
 * Route-level on purpose: marking individual elements is how five separate
 * leaks reached review, each fix covering the element reported while the next
 * unmarked surface leaked identically — including a second private card in this
 * very form. `tests/web/session-replay-routes.test.ts` pins the set of private
 * route groups that must have one of these.
 */
export default function EventsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ph-no-capture" data-ph-no-capture>
      {children}
    </div>
  );
}
