"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { api } from "@convex-generated-api";
import { Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";

/**
 * One profile, four things you can do to it.
 *
 * These surfaces used to be four destinations that each asked "which profile?"
 * on arrival, which inverted the way anyone actually thinks about them: you
 * decide to edit BITRATE, and only then decide whether you are editing its
 * privacy or its media kit. Picking the subject four separate times — from four
 * separate dropdowns, keyed on three different identifiers — was the cost of
 * that inversion.
 *
 * The subject is chosen once here and carried across the tabs. The identifier
 * each surface wants is derived from the same profile record, so the panels did
 * not have to agree on one.
 */

export type ProfileWorkspaceTab = "privacy" | "connections" | "personalization" | "media-kit";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

/**
 * Lets a panel say "not now" to a profile switch.
 *
 * The media-kit picker this replaced was disabled while an upload, a generation,
 * a replacement, or another operation was running. Switching mid-upload does not
 * cancel the in-flight request — `selectProfile` bumps the request refs, and the
 * request then sees the mismatch and deliberately skips its own
 * `setUploading(false)` — so the newly selected profile arrives showing an
 * upload that will never finish and controls that never re-enable.
 *
 * A context rather than a prop because the panel is `children` here, so the
 * state has to travel up.
 */
const WorkspaceBusyContext = createContext<((busy: boolean) => void) | null>(null);

export function useReportWorkspaceBusy() {
  return useContext(WorkspaceBusyContext);
}

/**
 * The subject the fixture panels render, so the workspace above them names the
 * same one. Mirrors `demoProfiles` in the privacy and appearance panels.
 */
export const DEMO_WORKSPACE_PROFILES: WorkspaceProfile[] = [
  {
    profileId: "demo",
    slug: "playwright-dj-aurora",
    displayName: "DJ Aurora",
    profileType: "person",
  },
];

export type WorkspaceProfile = {
  profileId: string;
  slug: string;
  displayName: string;
  profileType: "person" | "community";
};

const TABS: {
  key: ProfileWorkspaceTab;
  label: string;
  href: (profile: WorkspaceProfile) => string;
}[] = [
  {
    key: "privacy",
    label: "Privacy",
    href: (profile) => `/account/privacy?profileId=${encodeURIComponent(profile.profileId)}`,
  },
  {
    key: "connections",
    label: "Connections",
    href: (profile) => `/account/connections?profileSlug=${encodeURIComponent(profile.slug)}`,
  },
  {
    key: "personalization",
    label: "Personalization",
    href: (profile) => `/account/appearance?profileId=${encodeURIComponent(profile.profileId)}`,
  },
  {
    key: "media-kit",
    label: "Media kit",
    href: (profile) => `/account/media-kit?profile=${encodeURIComponent(profile.slug)}`,
  },
];

type ProfileWorkspaceProps = {
  activeProfileId?: string;
  activeSlug?: string;
  children: ReactNode;
  mediaKitEnabled?: boolean;
  /**
   * Fixture-mode profiles, mirroring how each panel already takes its own.
   *
   * The demo routes render a panel from injected data with no account behind
   * it, so the query answers `null` forever there. Without the same data the
   * workspace showed "Your profile" above an editor for DJ Aurora, with every
   * tab pointing back at `/account` — a header describing a different subject
   * from the panel underneath it.
   */
  previewProfiles?: WorkspaceProfile[];
  tab: ProfileWorkspaceTab;
};

/**
 * `ConvexClientProvider` deliberately renders no provider where
 * `NEXT_PUBLIC_CONVEX_URL` is unset, and `useQuery` throws without one. The
 * privacy and appearance panels already handle that environment with their own
 * "unavailable here" notice, so this must not crash on the way to letting them
 * render it — and `"skip"` does not help, because the hook still needs a
 * provider.
 */
export function ProfileWorkspace(props: ProfileWorkspaceProps) {
  if (!convexUrl && props.previewProfiles === undefined) {
    return <div className="grid gap-6">{props.children}</div>;
  }

  return <ConnectedProfileWorkspace {...props} />;
}

function ConnectedProfileWorkspace({
  activeProfileId,
  activeSlug,
  children,
  mediaKitEnabled = false,
  previewProfiles,
  tab,
}: ProfileWorkspaceProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const reportBusy = useMemo(() => (next: boolean) => setBusy(next), []);
  const owned = useQuery(
    api.profilePrivacy.listOwnedPrivacyProfilesForAccount,
    previewProfiles ? "skip" : {},
  );
  const profiles: WorkspaceProfile[] =
    previewProfiles ??
    (owned ?? []).map((profile) => ({
      profileId: profile.profileId,
      slug: profile.slug,
      displayName: profile.displayName,
      profileType: profile.profileType,
    }));
  // The three identifiers are all resolved against the same list, so a link
  // from any surface lands on the profile it named regardless of which key it
  // used. Falling back to the first owned profile keeps a bare `/account/privacy`
  // working the way it did before.
  const active =
    profiles.find((profile) => profile.profileId === activeProfileId) ??
    profiles.find((profile) => profile.slug === activeSlug) ??
    profiles[0];
  const visibleTabs = TABS.filter((entry) => entry.key !== "media-kit" || mediaKitEnabled);

  // A header that names no profile is worse than no header: it sits above a
  // panel that *has* resolved one and contradicts it, and its tabs all lead
  // back to `/account` rather than to the surface they name. Wait for the list
  // instead of rendering a workspace bound to nothing.
  if (active === undefined) {
    return (
      <div className="grid gap-6">
        <Link className="text-sm text-muted underline underline-offset-4" href="/account">
          All profiles
        </Link>
        {owned === undefined ? (
          <p className="text-sm text-muted">Loading your profiles…</p>
        ) : (
          <p className="text-sm text-muted">
            You do not manage any profiles yet. Claim one to edit it here.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div>
        <Link className="text-sm text-muted underline underline-offset-4" href="/account">
          All profiles
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              {active.profileType}
            </p>
            {/* Owned profiles include drafts, opted-out and suppressed ones, so
                the name here is not necessarily publicly readable. */}
            <h1 className="mt-1 text-3xl leading-none font-semibold sm:text-4xl" data-ph-no-capture>
              {active.displayName}
            </h1>
          </div>
          {profiles.length > 1 ? (
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Editing</span>
              {/* Option text is not an input value, so `maskAllInputs` does not
                  cover it. */}
              <Select
                aria-label="Profile to edit"
                data-ph-no-capture
                // Navigating away mid-upload strands the operation: it is not
                // cancelled, and the profile it lands on shows an upload that
                // never completes.
                disabled={busy}
                value={active.profileId}
                onChange={(event) => {
                  const next = profiles.find(
                    (profile) => profile.profileId === event.target.value,
                  );

                  if (next !== undefined) {
                    // Same tab, new subject — switching profiles should not
                    // also throw away the thing you came here to edit.
                    router.push(TABS.find((entry) => entry.key === tab)!.href(next));
                  }
                }}
              >
                {profiles.map((profile) => (
                  <option key={profile.profileId} value={profile.profileId}>
                    {profile.displayName}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
        </div>
      </div>

      <nav aria-label="Profile settings" className="border-b border-border">
        <ul className="-mb-px flex flex-wrap gap-1">
          {visibleTabs.map((entry) => (
            <li key={entry.key}>
              <Link
                aria-current={entry.key === tab ? "page" : undefined}
                className={cn(
                  "inline-flex border-b-2 px-3 py-2.5 text-sm font-medium transition",
                  entry.key === tab
                    ? "border-accent text-foreground"
                    : "border-transparent text-muted hover:border-border-strong hover:text-foreground",
                )}
                href={entry.href(active)}
              >
                {entry.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <WorkspaceBusyContext.Provider value={reportBusy}>{children}</WorkspaceBusyContext.Provider>
    </div>
  );
}
