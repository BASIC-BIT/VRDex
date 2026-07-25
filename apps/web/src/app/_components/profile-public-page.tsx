import Link from "next/link";
import { BadgeCheck, ExternalLink } from "lucide-react";
import { Fragment, type CSSProperties, type ReactNode } from "react";

import { EventPreviewCard, type PublicEventPreview } from "./event-public-page";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow, SectionHeading } from "@/components/ui/card";
import { CopyValueRow } from "@/components/ui/copy-value-row";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { avatarFrameStyle, defaultAvatarAppearance, type AvatarAppearance } from "@/lib/avatar-appearance";
import { cn } from "@/lib/cn";
import { profileClaimPath } from "@/lib/profile-claim";
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
  telemetry?: {
    freshness: "current" | "stale";
    observedAt?: number;
    currentPopulation?: { value: number; activeInstanceCount: number; observedAt: number };
    populationHistory?: Array<{ startAt: number; currentPopulation?: number; peakConcurrency: number; coverageRatio: number }>;
    groupMemberCount?: { value: number; observedAt: number };
    groupMemberGrowth?: { value: number; startAt: number; endAt: number };
    eventRecaps?: Array<{
      event?: { slug: string; title: string };
      startAt: number;
      peakConcurrency: number;
      playerHours: number;
      durationMinutes: number;
      coverageRatio: number;
    }>;
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

function CommunityActivity({ telemetry }: { telemetry: NonNullable<PublicCommunityProfile["telemetry"]> }) {
  const history = telemetry.populationHistory ?? [];
  const historyMax = Math.max(1, ...history.map((point) => point.peakConcurrency));
  const hasSummary = telemetry.currentPopulation || telemetry.groupMemberCount || telemetry.groupMemberGrowth;
  return (
    <section className="border-t border-border py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading>Activity</SectionHeading>
        <p className="text-xs text-muted">{telemetry.freshness === "current" ? "Current" : "Stale"}</p>
      </div>
      {hasSummary ? <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {telemetry.currentPopulation ? <Card padding="sm" surface="strong"><p className="text-sm text-muted">In group instances</p><p className="mt-2 text-3xl font-semibold">{telemetry.currentPopulation.value}</p><p className="mt-1 text-xs text-muted">{telemetry.currentPopulation.activeInstanceCount} active instances</p></Card> : null}
        {telemetry.groupMemberCount ? <Card padding="sm" surface="strong"><p className="text-sm text-muted">Group members</p><p className="mt-2 text-3xl font-semibold">{telemetry.groupMemberCount.value.toLocaleString()}</p></Card> : null}
        {telemetry.groupMemberGrowth ? <Card padding="sm" surface="strong"><p className="text-sm text-muted">Member growth</p><p className="mt-2 text-3xl font-semibold">{telemetry.groupMemberGrowth.value > 0 ? "+" : ""}{telemetry.groupMemberGrowth.value.toLocaleString()}</p></Card> : null}
      </div> : null}
      {history.length > 0 ? <div className="mt-6" aria-label="Hourly peak population history. Missing buckets are blank." role="img">
        <div className="flex h-32 items-end gap-1 border-b border-border" aria-hidden="true">
          {history.map((point) => {
            const missing = point.currentPopulation === undefined || point.coverageRatio <= 0;
            return <span className={cn("min-w-1 flex-1", missing ? "bg-transparent" : "bg-accent", !missing && (point.coverageRatio < 0.5 ? "opacity-30" : "opacity-85"))} key={point.startAt} style={{ height: missing ? 0 : `${Math.max(3, (point.peakConcurrency / historyMax) * 100)}%` }} />;
          })}
        </div>
        <p className="mt-2 text-xs text-muted">Hourly peak population · gaps remain unfilled</p>
      </div> : null}
      {telemetry.eventRecaps && telemetry.eventRecaps.length > 0 ? <div className="mt-7 grid gap-3 sm:grid-cols-2">{telemetry.eventRecaps.map((recap) => <Card key={`${recap.event?.slug ?? "event"}-${recap.startAt}`} padding="sm" surface="strong"><p className="font-medium">{recap.event?.title ?? "Event recap"}</p><p className="mt-2 text-sm text-muted">Peak {recap.peakConcurrency.toLocaleString()} · {recap.playerHours.toFixed(1)} player hours · {Math.round(recap.durationMinutes)} min · {Math.round(recap.coverageRatio * 100)}% coverage</p></Card>)}</div> : null}
    </section>
  );
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
  const bannerStyle = safeImageBackground(profile.bannerImageUrl);
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
  const aboutCopy = profile.bio?.trim();
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
    ...(profile.headline ? [] : focusItems.slice(0, 4)),
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

        <section className="overflow-hidden rounded-card border border-border bg-media shadow-panel">
          <div
            className="relative bg-media bg-cover bg-center p-5 text-white sm:p-6"
            style={bannerStyle}
          >
            {bannerStyle ? <span aria-hidden="true" className="absolute inset-0 bg-black/60" /> : null}
            <div
              className={cn(
                "relative grid gap-7",
                aboutCopy ? "lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)] lg:items-center" : undefined,
              )}
            >
              <div className="flex min-w-0 flex-col gap-6 sm:flex-row sm:items-center">
                <div className="relative w-fit shrink-0">
                  <div
                    aria-label={`${profile.displayName} display image`}
                    className="flex size-24 items-center justify-center bg-white/20 bg-cover bg-center text-3xl font-semibold shadow-panel"
                    role="img"
                    style={avatarStyle}
                  >
                    {!hasAvatarImage ? initialsFor(profile.displayName) : null}
                  </div>
                  {profile.trustLabel === "claimed_verified" ? (
                    <span
                      aria-describedby={`profile-verified-${profile.slug}`}
                      aria-label="Owner verified"
                      className="group absolute -right-2 -bottom-2 grid size-8 place-items-center rounded-full border-2 border-media bg-accent text-on-accent shadow-panel outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      role="img"
                      tabIndex={0}
                    >
                      <BadgeCheck aria-hidden="true" className="size-5" />
                      <span
                        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-control bg-foreground px-2 py-1 text-xs font-medium text-background shadow-panel group-hover:block group-focus:block"
                        id={`profile-verified-${profile.slug}`}
                        role="tooltip"
                      >
                        Owner verified
                      </span>
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0">
                  {profile.trustLabel === "claimed_verified" ? null : (
                    <p className="text-sm text-white/75">{sourceLine}</p>
                  )}
                  <h1 className="break-words text-4xl leading-none font-semibold sm:text-5xl">{profile.displayName}</h1>
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
                  {canClaim ? (
                    <Link
                      className={cn(buttonVariants({ variant: "inversePrimary" }), "mt-5 !text-[#08090d]")}
                      href={profileClaimPath(profile.slug, "profile")}
                    >
                      {profile.profileType === "person" ? "Is this you? Claim profile" : "Manage this community? Claim profile"}
                    </Link>
                  ) : null}
                </div>
              </div>
              {aboutCopy ? (
                <div className="border-white/20 lg:border-l lg:pl-7">
                  <h2 className="text-sm font-semibold text-white/70">About</h2>
                  <p className="mt-2 max-w-xl text-base leading-7 text-white/88">{aboutCopy}</p>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <div className={cn("grid gap-x-10", hasWatchSurface ? "lg:grid-cols-[minmax(0,1fr)_32rem]" : undefined)}>
          <div>
            {creatorLinks.length > 0 || discordHandles.length > 0 ? (
              <section className="py-8">
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
                  <CopyValueRow compact className="mt-4" key={item.link.url} label="Discord" value={handle} />
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
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
                    <p className="font-medium">{label}</p>
                    <a
                      className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "gap-2")}
                      href={stream.previewUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open preview
                      <ExternalLink aria-hidden="true" className="size-3.5" />
                    </a>
                  </div>
                  <CopyValueRow label="Quest (MPEG-TS)" value={stream.questUrl} />
                  <CopyValueRow label="PC (RTSPT)" value={stream.pcUrl} />
                </div>
              ))}
            </aside>
          ) : null}
        </div>

        {!isPerson && profile.telemetry ? <CommunityActivity telemetry={profile.telemetry} /> : null}

        {secondaryOrder.map((section) => {
          const content = secondarySections[section];
          return content ? <Fragment key={section}>{content}</Fragment> : null;
        })}
      </PageContainer>
    </PageShell>
  );
}
