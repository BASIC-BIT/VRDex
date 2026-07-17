import Link from "next/link";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { Fragment, type CSSProperties, type ReactNode } from "react";

import { EventPreviewCard, type PublicEventPreview } from "./event-public-page";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow, SectionHeading } from "@/components/ui/card";
import { CopyValueRow } from "@/components/ui/copy-value-row";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { avatarFrameStyle, defaultAvatarAppearance, type AvatarAppearance } from "@/lib/avatar-appearance";
import { cn } from "@/lib/cn";
import { safeImageBackground } from "@/lib/safe-image";
import type { TwitchLiveState } from "@/lib/server/twitch-live";
import { twitchLoginFromUrl } from "@/lib/twitch-url";
import { parseVrcdnStreamLinks } from "../../../../../convex/_vrcdnLinks";

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
  twitchLive?: TwitchLiveState;
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

const profileBannerOverlay = "linear-gradient(135deg, color-mix(in srgb, var(--media) 58%, transparent), color-mix(in srgb, var(--accent) 12%, transparent))";
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
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : null;
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
        className="flex aspect-[4/3] items-center justify-center rounded-control border border-border bg-[linear-gradient(135deg,var(--canvas-muted),var(--surface-raised))] bg-contain bg-center bg-no-repeat text-lg font-semibold text-white"
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
  const eventPreviews = isPerson ? profile.upcomingEvents : profile.hostedEvents;
  const aboutCopy = [profile.bio, profile.about].filter(
    (copy, index, copies): copy is string => Boolean(copy) && copies.indexOf(copy) === index,
  );
  const focusItems = Array.from(new Set(
    isPerson
      ? [...profile.person.roleTags, ...profile.tags]
      : [profile.community.subtype, ...profile.community.categoryTags, ...profile.tags].filter(
          (item): item is string => Boolean(item),
        ),
  ));
  const validLinks = profile.outboundLinks
    .map((link) => ({ link, href: safeHttpsUrl(link.url) }))
    .filter(
      (item): item is { link: (typeof profile.outboundLinks)[number]; href: string } => item.href !== null,
    );
  const twitchLink = validLinks.find(({ link }) => link.type === "twitch" && twitchLoginFromUrl(link.url));
  const discordHandles = validLinks.flatMap((item) => {
    if (item.link.type !== "discord") {
      return [];
    }

    const handle = item.link.handle ?? item.link.label.replace(/^Discord\s*:?\s*/i, "").trim();
    return handle && handle.toLowerCase() !== "discord" ? [{ handle, item }] : [];
  });
  const vrcdnStreams = validLinks.flatMap((item) => {
    const { link } = item;
    if (link.type !== "vrcdn") {
      return [];
    }

    const providerUrl = new URL(link.url);
    const stream = providerUrl.search || providerUrl.hash ? null : parseVrcdnStreamLinks(link.url);
    return stream ? [{ item, label: link.label, stream }] : [];
  });
  const creatorLinks = validLinks.filter(
    (item) =>
      item !== twitchLink &&
      !discordHandles.some((discord) => discord.item === item) &&
      !vrcdnStreams.some((vrcdn) => vrcdn.item === item),
  );
  const hasWatchSurface = Boolean(twitchLink || vrcdnStreams.length > 0);
  const aliases = profile.aliases.slice(0, 3);
  const remainingAliases = profile.aliases.slice(3);
  const sourceDate = formatSubmittedAt(profile.source?.submittedAt);
  const sourceLine = [trust, sourceDate].filter(Boolean).join(" / ");
  const metadata = Array.from(new Set([
    isPerson ? profile.person.pronouns : profile.community.subtype,
    profile.region,
    ...focusItems.slice(0, 4),
  ].filter((item): item is string => Boolean(item))));
  const hasMediaKit = Boolean(mediaKit.primaryLogo || mediaKit.additionalLogos.length > 0 || mediaKit.logoZipUrl);
  const canClaim = profile.trustLabel === "community_submitted" || profile.trustLabel === "unclaimed";
  const secondaryOrder = normalizeProfileSectionOrder(profile.appearance?.sectionOrder).filter((section) =>
    ["events", "media_kit", "worlds"].includes(section),
  );
  const secondarySections: Partial<Record<ProfilePublicSectionKey, ReactNode>> = {
    events: eventPreviews.length > 0 ? (
      <section className="border-t border-border py-8">
        <SectionHeading>{isPerson ? "Upcoming events" : "Hosted events"}</SectionHeading>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {eventPreviews.map((event) => (
            <EventPreviewCard event={event} key={`${event.slug ?? event.title}-${event.startAt}`} />
          ))}
        </div>
      </section>
    ) : null,
    media_kit: hasMediaKit ? (
      <section className="border-t border-border py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeading>Media kit</SectionHeading>
          {mediaKit.logoZipUrl ? (
            <a className={buttonVariants({ size: "sm", variant: "secondary" })} download href={mediaKit.logoZipUrl}>
              Download logos
            </a>
          ) : null}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mediaKit.primaryLogo ? <MediaAssetCard asset={mediaKit.primaryLogo} label="Primary logo" /> : null}
          {mediaKit.additionalLogos.map((asset, index) => (
            <MediaAssetCard asset={asset} key={asset.assetId} label={`Logo ${index + 2}`} />
          ))}
        </div>
      </section>
    ) : null,
    worlds: profile.worldCredits.length > 0 ? (
      <section className="border-t border-border py-8">
        <SectionHeading>Worlds</SectionHeading>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {profile.worldCredits.map((world) => (
            <Link
              className="rounded-card border border-border bg-surface-strong px-4 py-4 text-sm transition hover:border-border-strong"
              href={`/w/${world.slug}`}
              key={world.slug}
            >
              <span className="block text-lg font-semibold">{world.displayName}</span>
              <span className="mt-1 block text-muted">{world.roles.map(roleLabel).join(", ")}</span>
              {world.summary ? <span className="mt-3 line-clamp-2 block leading-6 text-muted">{world.summary}</span> : null}
            </Link>
          ))}
        </div>
      </section>
    ) : null,
  };

  return (
    <PageShell>
      <PageContainer>
        <PageNav>
          <BrandLink />
        </PageNav>

        <section className="overflow-hidden rounded-card border border-border bg-surface shadow-panel">
          <div
            className="min-h-64 bg-[linear-gradient(135deg,var(--media),var(--surface-raised))] bg-cover bg-center p-6 text-white sm:p-8"
            style={bannerStyle}
          >
            <div className="flex min-h-52 flex-col justify-end gap-6 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end">
                <div
                  aria-label={`${profile.displayName} display image`}
                  className="flex size-24 shrink-0 items-center justify-center bg-white/20 bg-cover bg-center text-3xl font-semibold shadow-panel"
                  role="img"
                  style={avatarStyle}
                >
                  {!hasAvatarImage ? initialsFor(profile.displayName) : null}
                </div>
                <div className="min-w-0 max-w-3xl">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-white/80">
                    {profile.trustLabel === "claimed_verified" ? <ShieldCheck aria-hidden="true" className="size-4" /> : null}
                    <span>{sourceLine}</span>
                  </div>
                  <h1 className="mt-2 break-words text-4xl leading-none font-semibold sm:text-5xl">{profile.displayName}</h1>
                  {aliases.length > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-white/75">
                      <span>AKA {aliases.join(", ")}</span>
                      {remainingAliases.length > 0 ? (
                        <details>
                          <summary className="cursor-pointer">+{remainingAliases.length} more</summary>
                          <span className="mt-1 block">{remainingAliases.join(", ")}</span>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                  {profile.headline ? <p className="mt-3 max-w-2xl text-base leading-7 text-white/85">{profile.headline}</p> : null}
                  {metadata.length > 0 ? <p className="mt-2 text-sm text-white/70">{metadata.join(" / ")}</p> : null}
                </div>
              </div>
              {canClaim ? (
                <Link
                  className={cn(buttonVariants({ variant: "inversePrimary" }), "!text-[#08090d]")}
                  href={`/account?claim=${encodeURIComponent(profile.slug)}&claimType=${profile.profileType}`}
                >
                  Claim this profile
                </Link>
              ) : null}
            </div>
          </div>
        </section>

        <div className={cn("grid gap-x-10", hasWatchSurface ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : undefined)}>
          <div>
            {aboutCopy.length > 0 ? (
              <section className="py-8">
                <SectionHeading>About</SectionHeading>
                <div className="mt-4 max-w-3xl space-y-4 text-base leading-7 text-muted">
                  {aboutCopy.map((copy) => (
                    <p key={copy}>{copy}</p>
                  ))}
                </div>
              </section>
            ) : null}

            {creatorLinks.length > 0 || discordHandles.length > 0 ? (
              <section className="border-t border-border py-8">
                <SectionHeading>Links</SectionHeading>
                <div className="mt-4 flex flex-wrap gap-2">
                  {creatorLinks.map(({ link, href }) => (
                    <a
                      className={cn(buttonVariants({ variant: "secondary" }), "gap-2")}
                      href={href}
                      key={`${link.type}-${link.url}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {link.label}
                      <ExternalLink aria-hidden="true" className="size-3.5" />
                    </a>
                  ))}
                </div>
                {discordHandles.map(({ handle, item }) => (
                  <CopyValueRow className="mt-4 max-w-md" key={item.link.url} label="Discord" value={handle} />
                ))}
              </section>
            ) : null}
          </div>

          {hasWatchSurface ? (
            <aside className="border-t border-border py-8 lg:border-t-0 lg:border-l lg:pl-8">
              <SectionHeading>Watch</SectionHeading>
              {twitchLink ? (
                <div className="mt-4 border-b border-border pb-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">Twitch</span>
                    {profile.twitchLive?.status === "live" ? (
                      <span className="text-sm font-medium text-success">Live now</span>
                    ) : null}
                  </div>
                  {profile.twitchLive?.status === "live" ? (
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{profile.twitchLive.title}</p>
                  ) : null}
                  <a className={cn(buttonVariants({ variant: "primary" }), "mt-4 w-full gap-2")} href={twitchLink.href} rel="noreferrer" target="_blank">
                    Watch on Twitch
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                  </a>
                </div>
              ) : null}
              {vrcdnStreams.map(({ label, stream }) => (
                <div className="pt-5" key={stream.streamId}>
                  <p className="font-medium">{label}</p>
                  <CopyValueRow label="Quest (MPEG-TS)" value={stream.questUrl} />
                  <CopyValueRow label="PC (RTSPT)" value={stream.pcUrl} />
                </div>
              ))}
            </aside>
          ) : null}
        </div>

        {secondaryOrder.map((section) => {
          const content = secondarySections[section];
          return content ? <Fragment key={section}>{content}</Fragment> : null;
        })}
      </PageContainer>
    </PageShell>
  );
}
