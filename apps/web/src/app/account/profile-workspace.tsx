"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

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

type WorkspaceProfile = {
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

export function ProfileWorkspace({
  activeProfileId,
  activeSlug,
  children,
  mediaKitEnabled = false,
  tab,
}: {
  activeProfileId?: string;
  activeSlug?: string;
  children: ReactNode;
  mediaKitEnabled?: boolean;
  tab: ProfileWorkspaceTab;
}) {
  const router = useRouter();
  const owned = useQuery(api.profilePrivacy.listOwnedPrivacyProfilesForAccount, {});
  const profiles: WorkspaceProfile[] = (owned ?? []).map((profile) => ({
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

  return (
    <div className="grid gap-6">
      <div>
        <Link className="text-sm text-muted underline underline-offset-4" href="/account">
          All profiles
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              {active?.profileType ?? "profile"}
            </p>
            {/* Owned profiles include drafts, opted-out and suppressed ones, so
                the name here is not necessarily publicly readable. */}
            <h1 className="mt-1 text-3xl leading-none font-semibold sm:text-4xl" data-ph-no-capture>
              {active?.displayName ?? "Your profile"}
            </h1>
          </div>
          {profiles.length > 1 && active ? (
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Editing</span>
              {/* Option text is not an input value, so `maskAllInputs` does not
                  cover it. */}
              <Select
                aria-label="Profile to edit"
                data-ph-no-capture
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
                // Without a resolved profile there is nothing to key the link
                // on, so the tabs stay visible but inert rather than sending
                // someone to a surface that would pick a different profile.
                href={active === undefined ? "/account" : entry.href(active)}
              >
                {entry.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {children}
    </div>
  );
}
