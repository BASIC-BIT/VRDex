"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { Component, FormEvent, ReactNode, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { api } from "@convex-generated-api";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card, cardVariants } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";
import type { Id } from "../../../../../../convex/_generated/dataModel";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

const privacyFieldKeys = [
  "aliases",
  "tags",
  "genres",
  "headline",
  "bio",
  "about",
  "avatarImageUrl",
  "bannerImageUrl",
  "outboundLinks",
  "region",
  "timezone",
  "personPronouns",
  "personRoleTags",
  "communitySubtype",
  "communityCategoryTags",
] as const;

type PrivacyFieldKey = (typeof privacyFieldKeys)[number];
type VisibilityState = "public" | "unlisted" | "private";
type ProfileType = "person" | "community";
type PrivacyDraft = Record<PrivacyFieldKey, VisibilityState>;
type FieldConfig = {
  key: PrivacyFieldKey;
  label: string;
};
type FieldGroup = {
  label: string;
  profileType?: ProfileType;
  fields: FieldConfig[];
};
type PrivacyProfile = {
  profileId: Id<"profiles"> | "demo";
  profileType: ProfileType;
  slug: string;
  displayName: string;
  claimState: "unclaimed" | "claimed_unverified" | "claimed_verified";
  fieldVisibility: PrivacyDraft;
};
type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "success" }
  | { kind: "error"; message: string };

const fieldGroups: FieldGroup[] = [
  {
    label: "Identity",
    fields: [
      { key: "aliases", label: "Aliases" },
      { key: "tags", label: "Tags" },
      { key: "genres", label: "Genres" },
      { key: "region", label: "Region" },
      { key: "timezone", label: "Time zone" },
    ],
  },
  {
    label: "Profile copy",
    fields: [
      { key: "headline", label: "Headline" },
      { key: "bio", label: "Bio" },
      { key: "about", label: "About" },
    ],
  },
  {
    label: "Media and links",
    fields: [
      { key: "avatarImageUrl", label: "Profile image URL" },
      { key: "bannerImageUrl", label: "Banner image URL" },
      { key: "outboundLinks", label: "Outbound links" },
    ],
  },
  {
    label: "Person fields",
    profileType: "person",
    fields: [
      { key: "personPronouns", label: "Pronouns" },
      { key: "personRoleTags", label: "Role tags" },
    ],
  },
  {
    label: "Community fields",
    profileType: "community",
    fields: [
      { key: "communitySubtype", label: "Subtype" },
      { key: "communityCategoryTags", label: "Category tags" },
    ],
  },
];

const defaultFieldVisibility = Object.fromEntries(
  privacyFieldKeys.map((key) => [key, "public"]),
) as PrivacyDraft;

const demoProfiles: PrivacyProfile[] = [
  {
    profileId: "demo",
    profileType: "person",
    slug: "playwright-dj-aurora",
    displayName: "DJ Aurora",
    claimState: "claimed_verified",
    fieldVisibility: {
      ...defaultFieldVisibility,
      bio: "unlisted",
      region: "private",
      timezone: "private",
      outboundLinks: "public",
    },
  },
];

function privacyErrorMessage(error: unknown): string {
  // Structured data first: Convex redacts plain error messages in production, so
  // matching on the message alone never sees a suppression conflict there and the
  // editor tells the owner to retry something that cannot succeed.
  const data = (error as { data?: { code?: string; message?: string } } | null)?.data;

  if (data?.code === "IDENTITY_SUPPRESSED") {
    return data.message ?? "This profile cannot be submitted.";
  }

  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(
    /Only a claimed profile owner can update profile privacy\.|Profile not found\.|Unsupported profile field visibility key "[^"]+"\.|Unsupported profile field visibility state for "[^"]+"\.|A signed-in account is required\./,
  );

  return match?.[0] ?? "Privacy update failed. Check the profile and try again.";
}

function profilePath(profile: PrivacyProfile): string {
  return `/${profile.profileType === "community" ? "c" : "p"}/${profile.slug}`;
}

function groupsForProfile(profile: PrivacyProfile): FieldGroup[] {
  return fieldGroups.filter((group) => group.profileType === undefined || group.profileType === profile.profileType);
}

function visibilityCounts(draft: PrivacyDraft, profile: PrivacyProfile) {
  const counts: Record<VisibilityState, number> = {
    public: 0,
    unlisted: 0,
    private: 0,
  };

  for (const group of groupsForProfile(profile)) {
    for (const field of group.fields) {
      counts[draft[field.key]] += 1;
    }
  }

  return counts;
}

function PrivacyEditor({
  demo,
  initialProfileId,
  profiles,
}: {
  demo?: boolean;
  initialProfileId?: string;
  profiles: PrivacyProfile[];
}) {
  const updateFieldVisibility = useMutation(api.profilePrivacy.updateFieldVisibility);
  const requestedProfile = profiles.find((profile) => profile.profileId === initialProfileId);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    requestedProfile?.profileId ?? profiles[0]?.profileId ?? "",
  );
  const selectedProfile = profiles.find((profile) => profile.profileId === selectedProfileId) ?? profiles[0];
  const [draft, setDraft] = useState<PrivacyDraft>(
    selectedProfile?.fieldVisibility ?? defaultFieldVisibility,
  );
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const appliedInitialProfileId = useRef<string | undefined>(undefined);
  const [, startTransition] = useTransition();
  const counts = useMemo(
    () => (selectedProfile ? visibilityCounts(draft, selectedProfile) : null),
    [draft, selectedProfile],
  );

  useEffect(() => {
    const requested = profiles.find((profile) => profile.profileId === initialProfileId);
    if (requested && appliedInitialProfileId.current !== initialProfileId) {
      appliedInitialProfileId.current = initialProfileId;
      setSelectedProfileId(requested.profileId);
    } else if (!selectedProfileId && profiles[0]) {
      setSelectedProfileId(profiles[0].profileId);
    }
  }, [initialProfileId, profiles, selectedProfileId]);

  useEffect(() => {
    if (selectedProfile) {
      setDraft({ ...selectedProfile.fieldVisibility });
      setStatus({ kind: "idle" });
    }
  }, [selectedProfile]);

  if (!selectedProfile || counts === null) {
    return null;
  }

  async function submitPrivacy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedProfile || demo || selectedProfile.profileId === "demo") {
      return;
    }

    setStatus({ kind: "saving" });

    try {
      await updateFieldVisibility({
        profileId: selectedProfile.profileId,
        fieldVisibility: draft,
      });
      startTransition(() => setStatus({ kind: "success" }));
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: privacyErrorMessage(error) }));
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <form className={cn(cardVariants({ surface: "glass" }), "grid gap-5")} onSubmit={submitPrivacy}>
        <div>
          <h2 className="text-2xl font-semibold">Field visibility</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{selectedProfile.displayName}</p>
        </div>

        <div className="grid gap-4">
          {groupsForProfile(selectedProfile).map((group) => (
            <fieldset className="grid gap-2" key={group.label}>
              <legend className="mb-1 text-sm font-semibold">{group.label}</legend>
              <div className="grid gap-2">
                {group.fields.map((field) => (
                  <label
                    className="grid gap-3 rounded-control border border-border bg-surface-strong px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center"
                    key={field.key}
                  >
                    <span className="font-medium">{field.label}</span>
                    <Select
                      aria-label={`${field.label} visibility`}
                      className="bg-surface"
                      value={draft[field.key]}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [field.key]: event.target.value as VisibilityState,
                        }))
                      }
                    >
                      <option value="public">Public</option>
                      <option value="unlisted">Unlisted</option>
                      <option value="private">Private</option>
                    </Select>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        {demo ? <Notice variant="dashed">Demo mode is live-only. Sign in and claim a profile to save privacy settings.</Notice> : null}
        {status.kind === "saving" ? <p className="text-sm text-muted">Saving privacy...</p> : null}
        {status.kind === "success" ? <Notice>Privacy saved.</Notice> : null}
        {status.kind === "error" ? <Notice variant="error">{status.message}</Notice> : null}

        <div className="flex flex-wrap gap-3">
          <Button disabled={demo || status.kind === "saving"} size="lg" type="submit" variant="primary">
            Save privacy
          </Button>
          <Link className={buttonVariants({ size: "lg", variant: "secondary" })} href={profilePath(selectedProfile)}>
            View profile
          </Link>
        </div>
      </form>

      <Card className="self-start" surface="strong">
        <h2 className="text-xl font-semibold">Current settings</h2>
        <dl className="mt-5 grid gap-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted">Public</dt>
            <dd className="font-mono">{counts.public}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted">Unlisted</dt>
            <dd className="font-mono">{counts.unlisted}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted">Private</dt>
            <dd className="font-mono">{counts.private}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}

function OwnerPrivacyPanel({ initialProfileId }: { initialProfileId?: string }) {
  const profiles = useQuery(api.profilePrivacy.listOwnedPrivacyProfilesForAccount);

  if (profiles === undefined) {
    return <p className="text-sm text-muted">Loading privacy settings...</p>;
  }

  if (profiles === null) {
    return (
      <Card surface="strong">
        <h2 className="text-2xl font-semibold">Sign in to manage privacy</h2>
        <p className="mt-3 text-sm leading-7 text-muted">Privacy settings belong to claimed profiles.</p>
        <Link className={cn(buttonVariants({ size: "lg", variant: "primary" }), "mt-5")} href="/sign-in">
          Sign in
        </Link>
      </Card>
    );
  }

  if (profiles.length === 0) {
    return (
      <Card surface="strong">
        <h2 className="text-2xl font-semibold">No owned profiles yet</h2>
        <p className="mt-3 text-sm leading-7 text-muted">Claim a person or community profile before changing field visibility.</p>
        <Link className={cn(buttonVariants({ size: "lg", variant: "secondary" }), "mt-5")} href="/account">
          Go to claims
        </Link>
      </Card>
    );
  }

  return <PrivacyEditor initialProfileId={initialProfileId} profiles={profiles} />;
}

function ConnectedPrivacyPanel({
  demoMode,
  initialProfileId,
}: {
  demoMode: boolean;
  initialProfileId?: string;
}) {
  if (demoMode) {
    return <PrivacyEditor demo profiles={demoProfiles} />;
  }

  return <OwnerPrivacyPanel initialProfileId={initialProfileId} />;
}

class PrivacyPanelErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <Notice className="leading-7" variant="dashed">
          Privacy settings are temporarily unavailable. Try again shortly.
        </Notice>
      );
    }

    return this.props.children;
  }
}

export function PrivacyPanel({
  demoMode = false,
  initialProfileId,
}: {
  demoMode?: boolean;
  initialProfileId?: string;
}) {
  if (!convexUrl && !demoMode) {
    return (
      <Notice className="leading-7" variant="dashed">
        Privacy settings are unavailable in this environment.
      </Notice>
    );
  }

  return (
    <PrivacyPanelErrorBoundary>
      <ConnectedPrivacyPanel demoMode={demoMode} initialProfileId={initialProfileId} />
    </PrivacyPanelErrorBoundary>
  );
}
