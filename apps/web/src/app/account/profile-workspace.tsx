"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Component,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
type WorkspaceControls = {
  setBusy: (busy: boolean) => void;
  /**
   * Move focus to the switcher.
   *
   * The media-kit panel calls this when the profile it was editing disappears
   * underneath it. Focus was sitting on a control that no longer exists, and the
   * subject changed without the user asking — leaving focus on the body would
   * strand a keyboard user with no announcement that anything moved. The panel
   * used to focus its own picker for this; the picker moved, the reason did not.
   *
   * Falls back to the heading, because the switcher only renders above more than
   * one profile — and a list shrinking to one is exactly a case where this is
   * called. The heading names the profile that was switched to, which is the
   * thing a keyboard user needs to hear.
   */
  focusSwitcher: () => void;
};

const WorkspaceControlsContext = createContext<WorkspaceControls | null>(null);

export function useWorkspaceControls() {
  return useContext(WorkspaceControlsContext);
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

/**
 * The media-kit fixture has two profiles, and its tests switch between them.
 * One entry would hide the switcher entirely, since it only renders above a
 * single profile.
 */
export const DEMO_MEDIA_KIT_WORKSPACE_PROFILES: WorkspaceProfile[] = [
  {
    profileId: "demo-profile",
    slug: "playwright-dj-aurora",
    displayName: "DJ Aurora",
    profileType: "person",
  },
  {
    profileId: "demo-community",
    slug: "playwright-night-shift",
    displayName: "Night Shift",
    profileType: "community",
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

  return (
    <WorkspaceChromeBoundary fallback={props.children}>
      <ConnectedProfileWorkspace {...props} />
    </WorkspaceChromeBoundary>
  );
}

/**
 * Drops the workspace chrome rather than the page when its query fails.
 *
 * The privacy and appearance panels each carry their own boundary and their own
 * "temporarily unavailable" notice. Adding a query *above* them meant a failing
 * backend — a schema deploy, say — took the whole settings route to the
 * app-level error surface instead, so the header quietly disabled failure
 * handling those panels already had. Falling back to the children restores it:
 * the header is chrome, and chrome is the part worth losing.
 */
class WorkspaceChromeBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <div className="grid gap-6">{this.props.fallback}</div>;
    }

    return this.props.children;
  }
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
  const switcherRef = useRef<HTMLSelectElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const controls = useMemo<WorkspaceControls>(
    () => ({
      setBusy,
      focusSwitcher: () => (switcherRef.current ?? headingRef.current)?.focus(),
    }),
    [],
  );
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
  const activeHref = active === undefined ? null : TABS.find((entry) => entry.key === tab)!.href(active);
  // Whether the URL names the profile actually being edited — not merely whether
  // it names *something*. A selector for a profile that is no longer owned falls
  // back here while each panel ignores it and keeps its own selection, so the
  // header said one profile and Save would have hit another. Canonicalizing on
  // resolution rather than on presence covers both that and the bare URL.
  const identified =
    active !== undefined &&
    (activeProfileId === active.profileId || activeSlug === active.slug);

  // A bare `/account/privacy` resolves to the first owned profile, and that
  // resolution lived only in this component. Switching to another profile and
  // pressing Back returned to the bare URL, where the header fell back to the
  // first profile again while the panel below kept the one it had — the page
  // then named one subject and saved to another. Writing the resolution into the
  // URL gives both the same answer and gives history something to return to.
  useEffect(() => {
    // Never against a preview list. In fixture mode the panels synthesise a
    // profile from the URL — `AppearancePanel` builds one for
    // `profileId=playwright-profile` — so the workspace's stub list cannot
    // contain every profile that is legitimately addressable, and rewriting to
    // its first entry threw away a selector the caller meant. Canonicalising is
    // only sound where the owned list is authoritative.
    if (previewProfiles === undefined && !identified && activeHref !== null) {
      router.replace(activeHref);
    }
  }, [activeHref, identified, previewProfiles, router]);

  // A header that names no profile is worse than no header: it sits above a
  // panel that *has* resolved one and contradicts it, and its tabs all lead
  // back to `/account` rather than to the surface they name. Wait for the list
  // instead of rendering a workspace bound to nothing.
  // `null` is a signed-out visitor, not an account with nothing in it. Treating
  // them the same told someone who had not signed in to go and claim a profile,
  // while suppressing the sign-in prompt the panel below was ready to show.
  if (owned === null && previewProfiles === undefined) {
    return <div className="grid gap-6">{children}</div>;
  }

  // Signed in and owning nothing goes to the panel too, because the panel knows
  // why *its* surface is unavailable and the chrome does not. Replacing that
  // with one grey sentence also dropped the only heading on the page.
  //
  // The link stays above it. Only privacy and personalization carry their own
  // way out; connections renders a notice and the media kit renders two words,
  // so without this an account with nothing to manage reaches those two tabs and
  // finds no route back to the claims surface at all.
  if (owned !== undefined && owned !== null && owned.length === 0 && previewProfiles === undefined) {
    return (
      <div className="grid gap-6">
        <Link className="text-sm text-muted underline underline-offset-4" href="/account">
          All profiles
        </Link>
        {children}
      </div>
    );
  }

  if (active === undefined) {
    return (
      <div className="grid gap-6">
        <Link className="text-sm text-muted underline underline-offset-4" href="/account">
          All profiles
        </Link>
        <p className="text-sm text-muted">Loading your profiles…</p>
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
            <h1
              className="mt-1 text-3xl leading-none font-semibold outline-none sm:text-4xl"
              data-ph-no-capture
              ref={headingRef}
              // Programmatic focus only — it never enters the tab order.
              tabIndex={-1}
            >
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
                ref={switcherRef}
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

      <WorkspaceControlsContext.Provider value={controls}>{children}</WorkspaceControlsContext.Provider>
    </div>
  );
}
