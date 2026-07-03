import Link from "next/link";
import { Fragment, type CSSProperties, type ReactNode } from "react";

import { EventPreviewCard, type PublicEventPreview } from "./event-public-page";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow, SectionHeading, SectionTitle } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { avatarFrameStyle, defaultAvatarAppearance, type AvatarAppearance } from "@/lib/avatar-appearance";
import { cn } from "@/lib/cn";
import { safeImageBackground } from "@/lib/safe-image";

type ProfileTrustLabel =
  | "community_submitted"
  | "unclaimed"
  | "claimed_unverified"
  | "claimed_verified";
type ProfileLinkType =
  | "vrchat_profile"
  | "vrcdn"
  | "discord"
  | "soundcloud"
  | "mixcloud"
  | "twitch"
  | "youtube"
  | "spotify"
  | "bandcamp"
  | "instagram"
  | "linktree"
  | "website"
  | "gumroad"
  | "jinxxy"
  | "payhip"
  | "woocommerce"
  | "kofi"
  | "patreon"
  | "commissions"
  | "generic_store"
  | "other";
type LinkSource = "owner_authored" | "reviewed" | "partner_provided";
type LinkPresentation = "icon" | "copy";
type WorldCreatorRole =
  | "world_author"
  | "builder"
  | "venue_operator"
  | "community_operator"
  | "media_credit"
  | "storefront_owner";

type PublicProfileGenre = {
  slug: string;
  displayName: string;
  displayLabel?: string;
  featured?: boolean;
};

type PublicProfileAsset = {
  assetId: string;
  label?: string;
  caption?: string;
  mimeType: string;
  byteSize: number;
  imageUrl: string;
  downloadUrl: string;
};

type PublicProfileMediaKit = {
  profileImage?: PublicProfileAsset;
  banner?: PublicProfileAsset;
  primaryLogo?: PublicProfileAsset;
  additionalLogos: PublicProfileAsset[];
  logos: PublicProfileAsset[];
  assets: PublicProfileAsset[];
  logoZipUrl?: string;
  compactDisplay: "profile_image" | "logo";
  avatarAppearance?: PublicProfileAvatarAppearance;
};

type PublicProfileAvatarAppearance = AvatarAppearance;
type ProfilePublicSectionKey = "about" | "events" | "links" | "media_kit" | "worlds" | "details";
type PublicProfileAppearance = {
  sectionOrder: ProfilePublicSectionKey[];
};

type PublicProfileBase = {
  profileType: "person" | "community";
  slug: string;
  displayName: string;
  aliases: string[];
  tags: string[];
  genres: PublicProfileGenre[];
  headline?: string;
  bio?: string;
  about?: string;
  avatarImageUrl?: string;
  bannerImageUrl?: string;
  region?: string;
  timezone?: string;
  trustLabel: ProfileTrustLabel;
  source?: {
    sourceType: "community";
    label: string;
    submittedAt?: number;
  };
  outboundLinks: Array<{
    type: ProfileLinkType;
    label: string;
    url: string;
    handle?: string;
    presentation?: LinkPresentation;
    source: LinkSource;
  }>;
  worldCredits: Array<{
    slug: string;
    displayName: string;
    roles: WorldCreatorRole[];
    tags: string[];
    summary?: string;
    sourceLabel?: string;
  }>;
  upcomingEvents: PublicEventPreview[];
  hostedEvents: PublicEventPreview[];
  appearance?: PublicProfileAppearance;
  mediaKit?: PublicProfileMediaKit;
};

type PublicPersonProfile = PublicProfileBase & {
  profileType: "person";
  person: {
    pronouns?: string;
    roleTags: string[];
  };
};

type PublicCommunityProfile = PublicProfileBase & {
  profileType: "community";
  community: {
    subtype?: string;
    categoryTags: string[];
  };
};

export type PublicProfile = PublicPersonProfile | PublicCommunityProfile;

function trustLabelCopy(label: ProfileTrustLabel) {
  if (label === "claimed_verified") {
    return "Verified";
  }

  if (label === "claimed_unverified") {
    return "Claimed";
  }

  if (label === "community_submitted") {
    return "Community submitted";
  }

  return "Unclaimed";
}

function initialsFor(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "VR";
}

const profileBannerOverlay = "linear-gradient(135deg, rgba(22, 17, 15, 0.58), rgba(214, 106, 77, 0.2))";
const profileSectionKeys: ProfilePublicSectionKey[] = [
  "about",
  "events",
  "links",
  "media_kit",
  "worlds",
  "details",
];
const defaultProfileSectionOrder: ProfilePublicSectionKey[] = [...profileSectionKeys];

function normalizeProfileSectionOrder(input: readonly ProfilePublicSectionKey[] | undefined): ProfilePublicSectionKey[] {
  const seen = new Set<ProfilePublicSectionKey>();
  const normalized: ProfilePublicSectionKey[] = [];

  for (const section of input ?? []) {
    if (!profileSectionKeys.includes(section) || seen.has(section)) {
      continue;
    }

    seen.add(section);
    normalized.push(section);
  }

  for (const section of defaultProfileSectionOrder) {
    if (!seen.has(section)) {
      normalized.push(section);
    }
  }

  return normalized;
}

function safeHttpsUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function formatSubmittedAt(value: number | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value),
  );
}

function hostLabel(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function roleLabel(role: WorldCreatorRole): string {
  return role
    .split("_")
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

function formatByteSize(value: number): string {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function mimeLabel(value: string): string {
  return value.replace(/^image\//, "").replace("svg+xml", "svg").toUpperCase();
}

function MediaAssetCard({ asset, label }: { asset: PublicProfileAsset; label: string }) {
  const imageStyle = safeImageBackground(asset.imageUrl);

  return (
    <a
      className="group grid gap-3 rounded-card border border-border bg-surface-strong p-3 text-sm transition hover:-translate-y-0.5 hover:shadow-panel"
      download
      href={asset.downloadUrl}
    >
      <span
        className="flex aspect-[4/3] items-center justify-center rounded-control border border-border bg-[linear-gradient(135deg,#2f211b,#d66a4d)] bg-contain bg-center bg-no-repeat text-lg font-semibold text-white"
        style={imageStyle}
      >
        {!imageStyle ? label.slice(0, 2).toUpperCase() : null}
      </span>
      <span className="grid gap-1">
        <span className="font-medium group-hover:text-accent-strong">{asset.label ?? label}</span>
        {asset.caption ? <span className="line-clamp-2 leading-5 text-muted">{asset.caption}</span> : null}
        <span className="text-xs text-muted">
          {mimeLabel(asset.mimeType)} / {formatByteSize(asset.byteSize)}
        </span>
      </span>
    </a>
  );
}

function PillList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-sm leading-6 text-muted">No public entries yet.</p>;
  }

  return (
    <p className="text-sm leading-6 text-muted">{items.join(" / ")}</p>
  );
}

export function ProfileBackendNotice({ kind }: { kind: "missing-url" | "error" }) {
  return (
    <PageShell className="py-10">
      <PageContainer max="3xl">
      <Card className="shadow-panel" padding="lg">
        <Eyebrow>Public profile</Eyebrow>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">
          {kind === "missing-url" ? "Convex URL not configured" : "Profile read failed"}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">
          {kind === "missing-url"
            ? "Run the local backend bootstrap before loading public profile pages from this worktree."
            : "Start the local Convex backend and reload this page once the profile query is reachable."}
        </p>
        <Link
          className={cn(buttonVariants({ size: "lg", variant: "secondary" }), "mt-6")}
          href="/"
        >
          Back to homepage
        </Link>
      </Card>
      </PageContainer>
    </PageShell>
  );
}

export function ProfilePublicPage({ profile }: { profile: PublicProfile }) {
  const trust = trustLabelCopy(profile.trustLabel);
  const isPerson = profile.profileType === "person";
  const focusItems: string[] = isPerson
    ? Array.from(new Set([...profile.person.roleTags, ...profile.tags]))
    : [profile.community.subtype, ...profile.community.categoryTags].filter(
        (item): item is string => Boolean(item),
      );
  const bannerStyle = safeImageBackground(profile.bannerImageUrl, profileBannerOverlay);
  const avatarImageStyle = safeImageBackground(profile.avatarImageUrl);
  const hasAvatarImage = avatarImageStyle !== undefined;
  const mediaKit = profile.mediaKit ?? {
    additionalLogos: [],
    logos: [],
    assets: [],
    compactDisplay: "profile_image" as const,
  };
  const avatarAppearance = mediaKit.avatarAppearance ?? defaultAvatarAppearance;
  const avatarStyle: CSSProperties = avatarFrameStyle(avatarImageStyle, avatarAppearance);
  const sourceSubmittedAt = formatSubmittedAt(profile.source?.submittedAt);
  const sourceDetails = [
    profile.source && profile.source.label !== trust ? profile.source.label : null,
    sourceSubmittedAt,
  ].filter((value): value is string => Boolean(value));
  const eventPreviews = isPerson ? profile.upcomingEvents : profile.hostedEvents;
  const sectionOrder = normalizeProfileSectionOrder(profile.appearance?.sectionOrder);
  const sections: Record<ProfilePublicSectionKey, ReactNode> = {
    about: (
      <section className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <Card>
          <Eyebrow>About</Eyebrow>
          <SectionTitle className="mt-4">
            {isPerson ? "Public identity" : "Community home"}
          </SectionTitle>
          <div className="mt-4 space-y-4 text-sm leading-7 text-muted sm:text-base">
            {profile.bio ? <p>{profile.bio}</p> : null}
            {profile.about ? <p>{profile.about}</p> : null}
            {!profile.bio && !profile.about ? (
              <p>No public bio yet.</p>
            ) : null}
          </div>
        </Card>

        <Card>
          <dl className="space-y-4 text-sm">
            <div className="border-b border-border pb-4">
              <dt className="text-muted">Status</dt>
              <dd className="mt-1 font-medium">
                {trust}
                {sourceDetails.length > 0 ? (
                  <span className="mt-1 block text-xs font-normal text-muted">
                    {sourceDetails.join(" / ")}
                  </span>
                ) : null}
              </dd>
            </div>
            <div className="border-b border-border pb-4">
              <dt className="text-muted">Region</dt>
              <dd className="mt-1 font-medium">{profile.region ?? "Not listed"}</dd>
            </div>
            <div className="border-b border-border pb-4">
              <dt className="text-muted">Time zone</dt>
              <dd className="mt-1 font-medium">{profile.timezone ?? "Not listed"}</dd>
            </div>
            {isPerson ? (
              <div>
                <dt className="text-muted">Pronouns</dt>
                <dd className="mt-1 font-medium">{profile.person.pronouns ?? "Not listed"}</dd>
              </div>
            ) : (
              <div>
                <dt className="text-muted">Subtype</dt>
                <dd className="mt-1 font-medium">{profile.community.subtype ?? "Not listed"}</dd>
              </div>
            )}
          </dl>
        </Card>
      </section>
    ),
    events: (
      <Card>
        <SectionHeading>
          {isPerson ? "Upcoming events" : "Hosted events"}
        </SectionHeading>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {eventPreviews.length === 0 ? (
            <p className="text-sm leading-6 text-muted">
              {isPerson ? "No public upcoming events yet." : "No public hosted events yet."}
            </p>
          ) : (
            eventPreviews.map((event) => (
              <EventPreviewCard event={event} key={`${event.slug ?? event.title}-${event.startAt}`} />
            ))
          )}
        </div>
      </Card>
    ),
    links: (
      <Card>
        <SectionHeading>
          Creator links
        </SectionHeading>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {profile.outboundLinks.length === 0 ? (
            <p className="text-sm leading-6 text-muted">No public creator/store links yet.</p>
          ) : (
            profile.outboundLinks.map((link) => {
              const href = safeHttpsUrl(link.url);

              if (!href) {
                return null;
              }

              const host = hostLabel(href);

              return (
                <a
                  className="rounded-card border border-border bg-surface-strong px-4 py-3 text-sm transition hover:-translate-y-0.5"
                  href={href}
                  key={`${link.type}-${link.url}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="block font-medium">{link.label}</span>
                  {link.handle ?? host ? <span className="mt-1 block text-xs text-muted">{link.handle ?? host}</span> : null}
                </a>
              );
            })
          )}
        </div>
      </Card>
    ),
    media_kit: (
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeading>
            Media kit
          </SectionHeading>
          {mediaKit.logoZipUrl ? (
            <a className={buttonVariants({ size: "sm", variant: "secondary" })} download href={mediaKit.logoZipUrl}>
              Download logos zip
            </a>
          ) : null}
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-card border border-border bg-surface-strong p-4">
            <p className="text-sm font-medium text-muted">Primary logo</p>
            {mediaKit.primaryLogo ? (
              <div className="mt-3">
                <MediaAssetCard asset={mediaKit.primaryLogo} label="Primary logo" />
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-muted">No public logo yet.</p>
            )}
          </div>
          <div className="rounded-card border border-border bg-surface-strong p-4">
            <p className="text-sm font-medium text-muted">Additional logos</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {mediaKit.additionalLogos.length === 0 ? (
                <p className="text-sm leading-6 text-muted">No additional public logos yet.</p>
              ) : (
                mediaKit.additionalLogos.map((asset, index) => (
                  <MediaAssetCard asset={asset} key={asset.assetId} label={`Logo ${index + 2}`} />
                ))
              )}
            </div>
          </div>
        </div>
      </Card>
    ),
    worlds: (
      <Card>
        <SectionHeading>
          Worlds
        </SectionHeading>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {profile.worldCredits.length === 0 ? (
            <p className="text-sm leading-6 text-muted">No public world credits yet.</p>
          ) : (
            profile.worldCredits.map((world) => (
              <Link
                className="rounded-card border border-border bg-surface-strong px-4 py-4 text-sm transition hover:-translate-y-0.5"
                href={`/w/${world.slug}`}
                key={world.slug}
              >
                <span className="block text-lg font-semibold tracking-[-0.03em]">
                  {world.displayName}
                </span>
                <span className="mt-2 block text-muted">
                  {world.roles.map(roleLabel).join(", ")}
                </span>
                {world.summary ? (
                  <span className="mt-3 line-clamp-2 block leading-6 text-muted">
                    {world.summary}
                  </span>
                ) : null}
                {world.tags.length > 0 ? (
                  <span className="mt-3 block text-xs text-muted">{world.tags.slice(0, 3).join(" / ")}</span>
                ) : null}
              </Link>
            ))
          )}
        </div>
      </Card>
    ),
    details: (
      <section className={cn("grid gap-4", isPerson ? "lg:grid-cols-2" : "lg:grid-cols-3")}>
        <Card>
          <Eyebrow>{isPerson ? "Focus" : "Community focus"}</Eyebrow>
          <div className="mt-4">
            <PillList items={focusItems} />
          </div>
        </Card>

        {isPerson ? null : (
          <Card>
            <Eyebrow>Tags</Eyebrow>
            <div className="mt-4">
              <PillList items={profile.tags} />
            </div>
          </Card>
        )}

        <Card>
          <Eyebrow>Aliases</Eyebrow>
          <div className="mt-4">
            <PillList items={profile.aliases} />
          </div>
        </Card>
      </section>
    ),
  };

  return (
    <PageShell>
      <PageContainer>
        <PageNav>
          <BrandLink />
          <Link
            className={buttonVariants({ variant: "secondary" })}
            href="/submit"
          >
            Add a missing profile
          </Link>
        </PageNav>

        <section className="overflow-hidden rounded-hero border border-border bg-surface shadow-hero backdrop-blur">
          <div
            className="min-h-64 bg-[radial-gradient(circle_at_top_left,rgba(214,106,77,0.26),transparent_34%),linear-gradient(135deg,#2f211b,#9f3f27)] bg-cover bg-center p-6 text-white sm:p-8 lg:p-10"
            style={bannerStyle}
          >
            <div className="flex min-h-52 flex-col justify-end gap-10">
              <div className="grid gap-6 lg:items-end">
                <div className="flex flex-col gap-4">
                  <div
                    className="flex size-24 items-center justify-center bg-white/20 bg-cover bg-center text-3xl font-semibold text-white shadow-panel"
                    style={avatarStyle}
                    role="img"
                    aria-label={`${profile.displayName} display image`}
                  >
                    {!hasAvatarImage ? initialsFor(profile.displayName) : null}
                  </div>

                  <div className="max-w-3xl">
                    <h1 className="text-5xl leading-none font-semibold tracking-[-0.05em] sm:text-7xl">
                      {profile.displayName}
                    </h1>
                    {profile.headline ?? profile.bio ? (
                      <p className="mt-4 max-w-2xl text-base leading-7 text-white/82 sm:text-lg">
                        {profile.headline ?? profile.bio}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {sectionOrder.map((section) => (
          <Fragment key={section}>{sections[section]}</Fragment>
        ))}
      </PageContainer>
    </PageShell>
  );
}
