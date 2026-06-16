"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Component, FormEvent, useDeferredValue, useEffect, useState, useTransition } from "react";

import { api } from "@convex-generated-api";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card, cardVariants, Eyebrow } from "@/components/ui/card";
import { Field, FieldText, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";
import { safeImageBackground } from "@/lib/safe-image";
import type { Id } from "../../../../../../convex/_generated/dataModel";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

type AvatarAppearance = {
  borderEnabled: boolean;
  borderColor: string;
  radiusPercent: number;
};

type AppearanceProfile = {
  profileId: Id<"profiles"> | "demo";
  profileType: "person" | "community";
  slug: string;
  displayName: string;
  headline?: string;
  avatarImageUrl?: string;
  avatarAppearance: AvatarAppearance;
};

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "success" }
  | { kind: "error"; message: string };

const defaultAvatarAppearance: AvatarAppearance = {
  borderEnabled: true,
  borderColor: "#ffffff",
  radiusPercent: 18,
};

const demoProfiles: AppearanceProfile[] = [
  {
    profileId: "demo",
    profileType: "person",
    slug: "playwright-dj-aurora",
    displayName: "DJ Aurora",
    headline: "Melodic house sets for late-night VRChat floors.",
    avatarImageUrl: "/api/e2e/fixture-assets/fixture-aurora-profile-image",
    avatarAppearance: {
      borderEnabled: true,
      borderColor: "#67e8f9",
      radiusPercent: 18,
    },
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
    /Only the profile owner can update profile appearance\.|Profile not found\.|Profile avatar border color must be a six-digit hex color\.|Profile avatar roundedness must be a number\.|A signed-in account is required\./,
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

function avatarStyle(profile: AppearanceProfile, appearance: AvatarAppearance): CSSProperties {
  return {
    ...safeImageBackground(profile.avatarImageUrl),
    borderColor: appearance.borderEnabled ? appearance.borderColor : "transparent",
    borderRadius: `${appearance.radiusPercent}%`,
    borderStyle: "solid",
    borderWidth: appearance.borderEnabled ? 4 : 0,
  };
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

function AppearanceEditor({ demo, profiles }: { demo?: boolean; profiles: AppearanceProfile[] }) {
  const updateAvatarAppearance = useMutation(api.profileAssets.updateAvatarAppearance);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(profiles[0]?.profileId ?? "");
  const selectedProfile = profiles.find((profile) => profile.profileId === selectedProfileId) ?? profiles[0];
  const [draft, setDraft] = useState<AvatarAppearance>(selectedProfile?.avatarAppearance ?? defaultAvatarAppearance);
  const deferredDraft = useDeferredValue(draft);
  const colorPickerValue = /^#[0-9a-fA-F]{6}$/.test(draft.borderColor) ? draft.borderColor : "#000000";
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!selectedProfileId && profiles[0]) {
      setSelectedProfileId(profiles[0].profileId);
    }
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (selectedProfile) {
      setDraft(selectedProfile.avatarAppearance);
      setStatus({ kind: "idle" });
    }
  }, [selectedProfile]);

  if (!selectedProfile) {
    return null;
  }

  async function submitAppearance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedProfile || demo || selectedProfile.profileId === "demo") {
      return;
    }

    setStatus({ kind: "saving" });

    try {
      await updateAvatarAppearance({
        profileId: selectedProfile.profileId,
        borderEnabled: draft.borderEnabled,
        borderColor: draft.borderColor,
        radiusPercent: draft.radiusPercent,
      });
      startTransition(() => setStatus({ kind: "success" }));
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: appearanceErrorMessage(error) }));
    }
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

        {profiles.length > 1 ? (
          <Field>
            Profile
            <Select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)}>
              {profiles.map((profile) => (
                <option key={profile.profileId} value={profile.profileId}>
                  {profile.displayName}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

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
          <FieldText>Use a six-digit hex color. Later this can pull from the profile theme palette.</FieldText>
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

        {demo ? (
          <Notice variant="dashed">Demo mode is live-only. Sign in and claim a profile to save appearance settings.</Notice>
        ) : null}
        {status.kind === "saving" ? <p className="text-sm text-muted">Saving appearance...</p> : null}
        {status.kind === "success" ? <Notice>Appearance saved.</Notice> : null}
        {status.kind === "error" ? <Notice variant="error">{status.message}</Notice> : null}

        <div className="flex flex-wrap gap-3">
          <Button disabled={demo || status.kind === "saving"} size="lg" type="submit" variant="primary">
            Save appearance
          </Button>
          <Link className={buttonVariants({ size: "lg", variant: "secondary" })} href={`/${selectedProfile.profileType === "community" ? "c" : "p"}/${selectedProfile.slug}`}>
            View profile
          </Link>
        </div>
      </form>

      <AvatarPreview appearance={deferredDraft} profile={selectedProfile} />
    </div>
  );
}

function OwnerAppearancePanel() {
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

  return <AppearanceEditor profiles={profiles} />;
}

function ConnectedAppearancePanel({ demoMode }: { demoMode: boolean }) {
  if (demoMode) {
    return <AppearanceEditor demo profiles={demoProfiles} />;
  }

  return <OwnerAppearancePanel />;
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

export function AppearancePanel({ demoMode = false }: { demoMode?: boolean }) {
  if (!convexUrl && !demoMode) {
    return (
      <Notice className="leading-7" variant="dashed">
        Convex is not configured in this environment, so appearance settings are unavailable.
      </Notice>
    );
  }

  return (
    <AppearancePanelErrorBoundary>
      <ConnectedAppearancePanel demoMode={demoMode} />
    </AppearancePanelErrorBoundary>
  );
}
