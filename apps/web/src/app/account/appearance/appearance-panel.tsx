"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Component, FormEvent, useDeferredValue, useEffect, useState, useTransition } from "react";

import { api } from "@convex-generated-api";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card, cardVariants, Eyebrow } from "@/components/ui/card";
import { Field, FieldText, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { avatarFrameStyle, defaultAvatarAppearance, type AvatarAppearance } from "@/lib/avatar-appearance";
import { cn } from "@/lib/cn";
import { safeImageBackground } from "@/lib/safe-image";
import type { Id } from "../../../../../../convex/_generated/dataModel";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

type AppearanceProfile = {
  hasPublicProfile: boolean;
  profileId: Id<"profiles"> | "demo" | "playwright-profile";
  profileType: "person" | "community";
  slug: string;
  displayName: string;
  headline?: string;
  avatarImageUrl?: string;
  avatarAppearance: AvatarAppearance;
  sectionOrder: ProfilePublicSectionKey[];
};

type ProfilePublicSectionKey = "about" | "events" | "links" | "media_kit" | "worlds" | "details";
type SupportingSectionKey = Extract<ProfilePublicSectionKey, "events" | "media_kit" | "worlds">;
type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "success" }
  | { kind: "error"; message: string };

const defaultSectionOrder: ProfilePublicSectionKey[] = [
  "about",
  "events",
  "links",
  "media_kit",
  "worlds",
  "details",
];

const supportingSectionOrder: SupportingSectionKey[] = ["events", "media_kit", "worlds"];

const sectionLabels: Record<SupportingSectionKey, string> = {
  events: "Events",
  media_kit: "Media kit",
  worlds: "Worlds",
};

const sectionDescriptions: Record<SupportingSectionKey, string> = {
  events: "Upcoming or hosted event cards.",
  media_kit: "Downloadable profile logos and reusable assets.",
  worlds: "World credits attached to this profile.",
};

function normalizeSupportingSectionOrder(input: readonly ProfilePublicSectionKey[]): SupportingSectionKey[] {
  const seen = new Set<SupportingSectionKey>();
  const normalized: SupportingSectionKey[] = [];

  for (const section of input) {
    if (!supportingSectionOrder.includes(section as SupportingSectionKey) || seen.has(section as SupportingSectionKey)) {
      continue;
    }

    seen.add(section as SupportingSectionKey);
    normalized.push(section as SupportingSectionKey);
  }

  for (const section of supportingSectionOrder) {
    if (!seen.has(section)) {
      normalized.push(section);
    }
  }

  return normalized;
}

const demoProfiles: AppearanceProfile[] = [
  {
    hasPublicProfile: true,
    profileId: "demo",
    profileType: "person",
    slug: "playwright-dj-aurora",
    displayName: "DJ Aurora",
    headline: "Melodic house sets for late-night VRChat floors.",
    avatarImageUrl: "/api/e2e/fixture-assets/fixture-aurora-profile-image",
    avatarAppearance: {
      borderEnabled: true,
      borderColor: "#67e8f9",
      borderWidthPx: 4,
      borderSoftnessPx: 12,
      radiusPercent: 18,
    },
    sectionOrder: defaultSectionOrder,
  },
];

function initialsFor(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "VR"
  );
}

function appearanceErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(
    /Only the profile owner can update profile appearance\.|Profile not found\.|Profile avatar border color must be a six-digit hex color\.|Profile avatar border thickness must be a number\.|Profile avatar border softness must be a number\.|Profile avatar roundedness must be a number\.|A signed-in account is required\./,
  );

  return match?.[0] ?? "Appearance update failed. Check the profile and try again.";
}

function roundednessLabel(value: number): string {
  if (value === 0) {
    return "Square";
  }

  if (value >= 50) {
    return "Circle";
  }

  if (value >= 32) {
    return "Round";
  }

  return "Soft";
}

function softnessLabel(value: number): string {
  if (value === 0) {
    return "Crisp";
  }

  if (value >= 16) {
    return "Glow";
  }

  if (value >= 8) {
    return "Feathered";
  }

  return "Soft edge";
}

function avatarStyle(profile: AppearanceProfile, appearance: AvatarAppearance): CSSProperties {
  return avatarFrameStyle(safeImageBackground(profile.avatarImageUrl), appearance);
}

function AvatarPreview({ appearance, profile }: { appearance: AvatarAppearance; profile: AppearanceProfile }) {
  const imageStyle = safeImageBackground(profile.avatarImageUrl);
  const style = avatarStyle(profile, appearance);

  return (
    <Card className="overflow-hidden shadow-panel" padding="none" surface="strong">
      <div className="bg-[radial-gradient(circle_at_top_right,rgba(214,106,77,0.28),transparent_32%),linear-gradient(135deg,#201511,#5e2d22_56%,#14100e)] p-6 text-white">
        <div className="flex items-end gap-5">
          <div
            aria-label={`${profile.displayName} preview avatar`}
            className="flex size-28 shrink-0 items-center justify-center bg-white/18 bg-cover bg-center text-4xl font-semibold shadow-panel"
            role="img"
            style={style}
          >
            {!imageStyle ? initialsFor(profile.displayName) : null}
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.22em] text-white/62">Live preview</p>
            <h2 className="mt-2 text-4xl leading-none font-semibold tracking-[-0.05em]">
              {profile.displayName}
            </h2>
            {profile.headline ? <p className="mt-3 max-w-xl text-sm leading-6 text-white/76">{profile.headline}</p> : null}
          </div>
        </div>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
        <div
          className="flex size-14 items-center justify-center bg-[linear-gradient(135deg,#2f211b,#d66a4d)] bg-cover bg-center text-lg font-semibold text-white"
          style={style}
        >
          {!imageStyle ? initialsFor(profile.displayName) : null}
        </div>
        <div className="min-w-0">
          <p className="font-semibold tracking-[-0.02em]">{profile.displayName}</p>
          <p className="text-sm text-muted">Search and compact-card preview</p>
        </div>
        <p className="text-sm text-muted">{roundednessLabel(appearance.radiusPercent)}</p>
      </div>
    </Card>
  );
}

function AppearanceEditor({
  demo,
  initialProfileId,
  profiles,
}: {
  demo?: boolean;
  initialProfileId?: string;
  profiles: AppearanceProfile[];
}) {
  const updateAppearance = useMutation(api.profileAssets.updateAppearance);
  const requestedProfile = profiles.find((profile) => profile.profileId === initialProfileId);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    requestedProfile?.profileId ?? profiles[0]?.profileId ?? "",
  );
  const selectedProfile = profiles.find((profile) => profile.profileId === selectedProfileId) ?? profiles[0];
  const [draft, setDraft] = useState<AvatarAppearance>(selectedProfile?.avatarAppearance ?? defaultAvatarAppearance);
  const [sectionOrder, setSectionOrder] = useState<SupportingSectionKey[]>(
    normalizeSupportingSectionOrder(selectedProfile?.sectionOrder ?? defaultSectionOrder),
  );
  const deferredDraft = useDeferredValue(draft);
  const colorPickerValue = /^#[0-9a-fA-F]{6}$/.test(draft.borderColor) ? draft.borderColor : "#000000";
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [, startTransition] = useTransition();

  // The subject now changes by navigation rather than by a picker inside this
  // panel, so the requested id arrives again on every switch. Seeding state only
  // on first render left the editor pointed at whichever profile happened to be
  // selected when the page first mounted.
  useEffect(() => {
    if (requestedProfile !== undefined) {
      setSelectedProfileId(requestedProfile.profileId);
    }
  }, [requestedProfile]);

  useEffect(() => {
    if (selectedProfile) {
      setDraft(selectedProfile.avatarAppearance);
      setSectionOrder(normalizeSupportingSectionOrder(selectedProfile.sectionOrder));
      setStatus({ kind: "idle" });
    }
  }, [selectedProfile]);

  if (!selectedProfile) {
    return null;
  }

  async function submitAppearance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !selectedProfile ||
      demo ||
      selectedProfile.profileId === "demo" ||
      selectedProfile.profileId === "playwright-profile"
    ) {
      return;
    }

    setStatus({ kind: "saving" });

    try {
      await updateAppearance({
        profileId: selectedProfile.profileId,
        borderEnabled: draft.borderEnabled,
        borderColor: draft.borderColor,
        borderWidthPx: draft.borderWidthPx,
        borderSoftnessPx: draft.borderSoftnessPx,
        radiusPercent: draft.radiusPercent,
        sectionOrder: ["about", "links", ...sectionOrder, "details"],
      });
      startTransition(() => setStatus({ kind: "success" }));
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: appearanceErrorMessage(error) }));
    }
  }

  function moveSection(section: SupportingSectionKey, direction: -1 | 1) {
    setSectionOrder((current) => {
      const index = current.indexOf(section);
      const nextIndex = index + direction;

      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];

      return next;
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <form className={cn(cardVariants({ surface: "glass" }), "grid gap-5")} onSubmit={submitAppearance}>
        <div>
          <Eyebrow>Avatar frame</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">Profile picture shape and border</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Keep the uploaded image reusable. These controls only change how the public avatar frame presents it.
          </p>
        </div>

        <label className="flex items-center justify-between gap-4 rounded-control border border-border bg-surface-strong px-4 py-3 text-sm font-medium">
          <span>
            Show border
            <span className="mt-1 block text-xs font-normal text-muted">Turn the avatar frame on or off.</span>
          </span>
          <input
            checked={draft.borderEnabled}
            className="size-5 accent-[var(--color-accent)]"
            type="checkbox"
            onChange={(event) => setDraft((current) => ({ ...current, borderEnabled: event.target.checked }))}
          />
        </label>

        <Field>
          Border color
          <div className="grid grid-cols-[4rem_1fr] gap-3">
            <input
              aria-label="Border color picker"
              className="h-full min-h-12 rounded-control border border-border bg-surface-strong p-1"
              type="color"
              value={colorPickerValue}
              onChange={(event) => setDraft((current) => ({ ...current, borderColor: event.target.value }))}
            />
            <Input
              inputMode="text"
              pattern="#[0-9a-fA-F]{6}"
              value={draft.borderColor}
              onChange={(event) => setDraft((current) => ({ ...current, borderColor: event.target.value }))}
            />
          </div>
          <FieldText>Use a six-digit hex color.</FieldText>
        </Field>

        <Field>
          Roundedness
          <div className="rounded-control border border-border bg-surface-strong px-4 py-4">
            <input
              aria-label="Avatar roundedness"
              className="w-full accent-[var(--color-accent)]"
              max={50}
              min={0}
              type="range"
              value={draft.radiusPercent}
              onChange={(event) =>
                setDraft((current) => ({ ...current, radiusPercent: Number(event.target.value) }))
              }
            />
            <div className="mt-2 flex items-center justify-between text-xs text-muted">
              <span>Square</span>
              <span className="font-medium text-foreground">{draft.radiusPercent}% / {roundednessLabel(draft.radiusPercent)}</span>
              <span>Circle</span>
            </div>
          </div>
        </Field>

        <Field>
          Border thickness
          <div className="rounded-control border border-border bg-surface-strong px-4 py-4">
            <input
              aria-label="Avatar border thickness"
              className="w-full accent-[var(--color-accent)]"
              disabled={!draft.borderEnabled}
              max={10}
              min={1}
              type="range"
              value={draft.borderWidthPx}
              onChange={(event) =>
                setDraft((current) => ({ ...current, borderWidthPx: Number(event.target.value) }))
              }
            />
            <div className="mt-2 flex items-center justify-between text-xs text-muted">
              <span>Hairline</span>
              <span className="font-medium text-foreground">{draft.borderWidthPx}px</span>
              <span>Bold</span>
            </div>
          </div>
        </Field>

        <Field>
          Border softness
          <div className="rounded-control border border-border bg-surface-strong px-4 py-4">
            <input
              aria-label="Avatar border softness"
              className="w-full accent-[var(--color-accent)]"
              disabled={!draft.borderEnabled}
              max={24}
              min={0}
              type="range"
              value={draft.borderSoftnessPx}
              onChange={(event) =>
                setDraft((current) => ({ ...current, borderSoftnessPx: Number(event.target.value) }))
              }
            />
            <div className="mt-2 flex items-center justify-between text-xs text-muted">
              <span>Crisp</span>
              <span className="font-medium text-foreground">{draft.borderSoftnessPx}px / {softnessLabel(draft.borderSoftnessPx)}</span>
              <span>Glow</span>
            </div>
            <FieldText className="mt-2">Softness feathers the border color outward as a subtle gradient glow.</FieldText>
          </div>
        </Field>

        <div className="grid gap-3">
          <div>
            <Eyebrow>Profile sections</Eyebrow>
            <h3 className="mt-2 text-xl font-semibold">Supporting section order</h3>
          </div>
          <div className="grid gap-2">
            {sectionOrder.map((section, index) => (
              <div
                className="grid gap-3 rounded-control border border-border bg-surface-strong px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
                key={section}
              >
                <div>
                  <p className="text-sm font-medium">{sectionLabels[section]}</p>
                  <p className="mt-1 text-xs leading-5 text-muted">{sectionDescriptions[section]}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    disabled={index === 0}
                    size="sm"
                    type="button"
                    variant="secondary"
                    onClick={() => moveSection(section, -1)}
                  >
                    Up
                  </Button>
                  <Button
                    disabled={index === sectionOrder.length - 1}
                    size="sm"
                    type="button"
                    variant="secondary"
                    onClick={() => moveSection(section, 1)}
                  >
                    Down
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {status.kind === "saving" ? <p className="text-sm text-muted">Saving appearance...</p> : null}
        {status.kind === "success" ? <Notice>Appearance saved.</Notice> : null}
        {status.kind === "error" ? <Notice variant="error">{status.message}</Notice> : null}

        <div className="flex flex-wrap gap-3">
          <Button disabled={demo || status.kind === "saving"} size="lg" type="submit" variant="primary">
            Save appearance
          </Button>
          {selectedProfile.hasPublicProfile ? (
            <Link className={buttonVariants({ size: "lg", variant: "secondary" })} href={`/${selectedProfile.profileType === "community" ? "c" : "p"}/${selectedProfile.slug}`}>
              View profile
            </Link>
          ) : null}
        </div>
      </form>

      <AvatarPreview appearance={deferredDraft} profile={selectedProfile} />
    </div>
  );
}

function OwnerAppearancePanel({ initialProfileId }: { initialProfileId?: string }) {
  const profiles = useQuery(api.profileAssets.listOwnedAppearanceProfiles);

  if (profiles === undefined) {
    return <p className="text-sm text-muted">Loading appearance settings...</p>;
  }

  if (profiles === null) {
    return (
      <Card surface="strong">
        <h2 className="text-2xl font-semibold tracking-[-0.03em]">Sign in to customize a profile</h2>
        <p className="mt-3 text-sm leading-7 text-muted">Appearance settings belong to claimed profiles.</p>
        <Link className={cn(buttonVariants({ size: "lg", variant: "primary" }), "mt-5")} href="/sign-in">
          Sign in
        </Link>
      </Card>
    );
  }

  if (profiles.length === 0) {
    return (
      <Card surface="strong">
        <h2 className="text-2xl font-semibold tracking-[-0.03em]">No owned profiles yet</h2>
        <p className="mt-3 text-sm leading-7 text-muted">Claim a person or community profile before changing public appearance.</p>
        <Link className={cn(buttonVariants({ size: "lg", variant: "secondary" }), "mt-5")} href="/account">
          Go to claims
        </Link>
      </Card>
    );
  }

  return <AppearanceEditor initialProfileId={initialProfileId} profiles={profiles} />;
}

function ConnectedAppearancePanel({
  demoMode,
  initialProfileId,
}: {
  demoMode: boolean;
  initialProfileId?: string;
}) {
  if (demoMode) {
    const profiles = initialProfileId === "playwright-profile"
      ? [{
          ...demoProfiles[0],
          hasPublicProfile: false,
          profileId: "playwright-profile" as const,
        }]
      : demoProfiles;

    return <AppearanceEditor demo initialProfileId={initialProfileId} profiles={profiles} />;
  }

  return <OwnerAppearancePanel initialProfileId={initialProfileId} />;
}

class AppearancePanelErrorBoundary extends Component<
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
          Appearance settings are temporarily unavailable because the backend query failed. Try again after the Convex deployment finishes.
        </Notice>
      );
    }

    return this.props.children;
  }
}

export function AppearancePanel({
  demoMode = false,
  initialProfileId,
}: {
  demoMode?: boolean;
  initialProfileId?: string;
}) {
  if (!convexUrl && !demoMode) {
    return (
      <Notice className="leading-7" variant="dashed">
        Convex is not configured in this environment, so appearance settings are unavailable.
      </Notice>
    );
  }

  return (
    <AppearancePanelErrorBoundary>
      <ConnectedAppearancePanel demoMode={demoMode} initialProfileId={initialProfileId} />
    </AppearancePanelErrorBoundary>
  );
}
