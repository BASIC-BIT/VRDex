import type { ReactNode } from "react";

import { AccountSessionBoundary } from "./account-session-boundary";

/**
 * Blocks every `/account` surface from session replay.
 *
 * Replay records all routes and is kept safe by masking, but `maskAllInputs`
 * covers input *values* only — not rendered text. Every page under `/account`
 * is owner-only, and the owned-profile lists behind them are not filtered by
 * public readability: `listOwnedAppearanceProfiles`,
 * `listOwnedPrivacyProfilesForAccount` and their siblings return draft,
 * opted-out and safety-suppressed profiles, whose display names, headlines,
 * avatars and media would otherwise reach PostHog just by opening an editor.
 *
 * Done here rather than per panel on purpose. Marking individual regions is how
 * three separate leaks on these pages survived review — each fix covered the
 * element that was reported and the next unmarked surface leaked the same way.
 * A route-level block cannot be outgrown by a new panel.
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ph-no-capture" data-ph-no-capture>
      <AccountSessionBoundary>{children}</AccountSessionBoundary>
    </div>
  );
}
