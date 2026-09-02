import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Fragment, type CSSProperties, type ReactNode } from "react";

import { EventPreviewCard, type PublicEventPreview } from "./event-public-page";
import { MediaPreviewImage } from "./media-preview-image";
import { ProfileVrcdnStreams } from "./profile-vrcdn-streams";
import { ProfilePrivateRecord } from "./profile-private-record";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow, SectionHeading } from "@/components/ui/card";
import { CopyValueRow } from "@/components/ui/copy-value-row";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { VerifiedTrustMark } from "@/components/ui/verified-trust-mark";
import { avatarFrameStyle, defaultAvatarAppearance, type AvatarAppearance } from "@/lib/avatar-appearance";
import { cn } from "@/lib/cn";
import { profileClaimPath } from "@/lib/profile-claim";
import { hasRenderableProfileMediaKit } from "@/lib/profile-media-kit";
import { safeImageBackground } from "@/lib/safe-image";
import type { TwitchLiveState } from "@/lib/server/twitch-live";
import type { VrcdnLiveState } from "@/lib/vrcdn-live";
import { twitchLinkForLiveClaim, twitchLoginFromUrl } from "@/lib/twitch-url";
import { parseVrcdnStreamLinks, vrcdnPlaybackHref } from "../../../../../convex/_vrcdnLinks";

/**
 * Rendered on the server, so the viewer's locale is unavailable and a
 * locale-dependent format would differ between the server pass and hydration.
 * UTC for the same reason: a submission timestamp is a fact about the record,
 * not something to shift into whichever timezone happens to be reading it.
 */
function formatSubmittedDate(value: number) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  });
}

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
type LinkSource = "owner_authored" | "reviewed" | "partner_provided" | "community_submitted";
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
  altText?: string;
  credit?: string;
  creditUrl?: string;
  mimeType: string;
  byteSize: number;
  downloadMimeType?: string;
  downloadByteSize?: number;
  sourcePreserved?: boolean;
  imageUrl: string;
  downloadUrl: string;
};

type PublicProfileMediaKit = {
  profileImage?: PublicProfileAsset;
  banner?: PublicProfileAsset;
  featuredAsset?: PublicProfileAsset;
  primaryLogo?: PublicProfileAsset;
  additionalLogos: PublicProfileAsset[];
  logos: PublicProfileAsset[];
  assets: PublicProfileAsset[];
  galleryAssets?: PublicProfileAsset[];
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
  id?: string;
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
  updatedAt?: number;
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
  vrcdnLive?: Record<string, VrcdnLiveState>;
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

function safeCreditUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed.href
      : null;
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

function MediaAssetCard({ asset, label, featured = false }: { asset: PublicProfileAsset; label: string; featured?: boolean }) {
  const creditUrl = safeCreditUrl(asset.creditUrl);
  const downloadMimeType = asset.downloadMimeType ?? asset.mimeType;
  const downloadByteSize = asset.downloadByteSize ?? asset.byteSize;
  return (
    <article className={cn("group grid overflow-hidden rounded-card border border-border bg-surface-strong text-sm transition hover:-translate-y-0.5 hover:shadow-panel", featured ? "lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]" : undefined)}>
      <div className={cn("relative bg-canvas-muted", featured ? "min-h-72" : "aspect-[4/3]")}>
        <MediaPreviewImage
          alt={asset.altText || asset.label || label}
          className="absolute inset-0 size-full object-contain"
          src={asset.imageUrl}
        />
      </div>
      <div className="grid content-start gap-2 p-4">
        <h3 className={cn("font-medium", featured ? "text-xl" : undefined)}>{asset.label ?? label}</h3>
        {asset.caption ? <p className="leading-6 text-muted">{asset.caption}</p> : null}
        {creditUrl ? (
          <a className="w-fit break-all text-xs text-muted underline underline-offset-4" href={creditUrl}>
            {asset.credit || creditUrl}
          </a>
        ) : asset.credit ? (
          <p className="text-xs text-muted">{asset.credit}</p>
        ) : null}
        <p className="text-xs text-muted">
          {mimeLabel(downloadMimeType)} / {formatByteSize(downloadByteSize)}
        </p>
        <a aria-label={`Download ${asset.label ?? label}`} className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "mt-2 w-fit")} download href={asset.downloadUrl}>
          Download
        </a>
      </div>
    </article>
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
  const isPerson = profile.profileType === "person";
  const bannerStyle = safeImageBackground(profile.bannerImageUrl);
  const avatarImageStyle = safeImageBackground(profile.avatarImageUrl);
  const hasAvatarImage = avatarImageStyle !== undefined;
  const mediaKit = profile.mediaKit ?? {
    additionalLogos: [],
    logos: [],
    assets: [],
    galleryAssets: [],
    compactDisplay: "profile_image" as const,
  };
  const avatarAppearance = mediaKit.avatarAppearance ?? defaultAvatarAppearance;
  const avatarStyle: CSSProperties = avatarFrameStyle(avatarImageStyle, avatarAppearance);
  const eventPreviews = isPerson ? profile.upcomingEvents : profile.hostedEvents;
  const canClaim = profile.trustLabel === "community_submitted" || profile.trustLabel === "unclaimed";
  // Owner-authored personalization wins when present; the factual/community
  // bio remains the fallback instead of rendering two competing About blocks.
  // An unclaimed record has no owner yet, so its longer community narrative is
  // not treated as owner-authored personalization.
  const aboutCopy = canClaim
    ? profile.bio?.trim()
    : profile.about?.trim() || profile.bio?.trim();
  const focusItems = Array.from(new Set(
    isPerson
      ? [...profile.person.roleTags, ...profile.tags]
      : [profile.community.subtype, ...profile.community.categoryTags, ...profile.tags].filter(
          (item): item is string => Boolean(item),
        ),
  ));
  const validLinks = profile.outboundLinks
    // VRCDN resolved before the HTTPS filter, because its stored value is an
    // identifier rather than an address and `safeHttpsUrl` drops it. Filtering
    // first took the stream back out of `vrcdnStreams` below, which is the whole
    // watch and copy surface for a creator whose only link is their stream.
    .map((link) => ({ link, href: vrcdnPlaybackHref(link.url) ?? safeHttpsUrl(link.url) }))
    .filter(
      (item): item is { link: (typeof profile.outboundLinks)[number]; href: string } =>
        item.href !== null && item.href !== undefined,
    );
  // The very link the probe used, found by the same selector rather than by a
  // second pass that happens to agree. The fallback keeps an unvetted link
  // rendering as a plain watch button -- the link was never the problem, the
  // claim about who is streaming was, and `twitchLive` stays undefined for it.
  const claimedTwitchLink = twitchLinkForLiveClaim(profile.outboundLinks);
  const twitchLink =
    (claimedTwitchLink && validLinks.find(({ link }) => link === claimedTwitchLink)) ??
    validLinks.find(({ link }) => link.type === "twitch" && twitchLoginFromUrl(link.url));
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
  const metadata = Array.from(new Set([
    isPerson ? profile.person.pronouns : profile.community.subtype,
    profile.region,
    ...(profile.headline ? [] : focusItems.slice(0, 4)),
  ].filter((item): item is string => Boolean(item))));
  const mediaKitGalleryEnabled =
    process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED === "true" ||
    process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES === "true";
  const galleryAssets = mediaKit.galleryAssets ?? [];
  const galleryAssetIds = new Set([
    ...galleryAssets.map((asset) => asset.assetId),
    ...(mediaKit.featuredAsset ? [mediaKit.featuredAsset.assetId] : []),
  ]);
  const remainingLogos = mediaKit.logos.filter((asset) => !galleryAssetIds.has(asset.assetId));
  const hasMediaKit = hasRenderableProfileMediaKit({
    additionalLogoCount: mediaKit.additionalLogos.length,
    galleryAssetCount: galleryAssets.length,
    galleryEnabled: mediaKitGalleryEnabled,
    hasPrimaryLogo: mediaKit.primaryLogo !== undefined,
    logoCount: mediaKit.logos.length,
  });
  const profileBasePath = `/${profile.slug}`;
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
        {mediaKitGalleryEnabled && mediaKit.featuredAsset ? (
          <div className="mt-5">
            <MediaAssetCard asset={mediaKit.featuredAsset} featured label="Featured media" />
          </div>
        ) : null}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mediaKitGalleryEnabled ? (
            galleryAssets
              .filter((asset) => asset.assetId !== mediaKit.featuredAsset?.assetId)
              .map((asset, index) => (
                <MediaAssetCard asset={asset} key={asset.assetId} label={`Media ${index + 1}`} />
              ))
          ) : (
            <>
              {mediaKit.primaryLogo ? <MediaAssetCard asset={mediaKit.primaryLogo} label="Primary logo" /> : null}
              {mediaKit.additionalLogos.map((asset, index) => (
                <MediaAssetCard asset={asset} key={asset.assetId} label={`Logo ${index + 2}`} />
              ))}
            </>
          )}
          {mediaKitGalleryEnabled
            ? remainingLogos.map((asset, index) => (
                <MediaAssetCard asset={asset} key={asset.assetId} label={`Logo ${index + 1}`} />
              ))
            : null}
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
              href={`/${world.slug}`}
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

        <section
          aria-labelledby={`profile-title-${profile.slug}`}
          className="overflow-hidden rounded-card border border-border bg-media shadow-panel"
        >
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
                    <VerifiedTrustMark className="verified-trust-mark--avatar" />
                  ) : null}
                </div>
                <div className="min-w-0">
                  <h1
                    className="break-words text-4xl leading-none font-semibold sm:text-5xl"
                    id={`profile-title-${profile.slug}`}
                  >
                    {profile.displayName}
                  </h1>
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
              {aboutCopy ? (
                <div className="border-white/20 lg:border-l lg:pl-7">
                  <h2 className="text-sm font-semibold text-white/70">About</h2>
                  <p className="mt-2 max-w-xl text-base leading-7 text-white/88">{aboutCopy}</p>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {canClaim || profile.source ? (
          <aside aria-label="Profile ownership" className="grid justify-items-end gap-2 py-4">
            {/* Provenance describes the record, not the person. Sitting above
                the display name it read as a label on them; here it is one of
                the facts about how this listing came to exist, as plain text
                with the date on its own line.
                A published import carries no `sourceAttribution` -- deliberately,
                since "Community submitted" would be false provenance for an
                operator import -- so it needs its own line rather than none.
                Every unclaimed listing says so, which is what the repo means by
                labelling an unclaimed profile as unverified. */}
            {profile.source ? (
              <p className="text-right text-sm text-muted">
                {profile.source.label}
                {profile.source.submittedAt !== undefined ? (
                  <span className="block">{formatSubmittedDate(profile.source.submittedAt)}</span>
                ) : null}
              </p>
            ) : profile.trustLabel === "unclaimed" ? (
              <p className="text-right text-sm text-muted">Unclaimed</p>
            ) : null}

            {canClaim ? (
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                <p className="text-sm text-muted">
                  {profile.profileType === "person" ? "Is this your profile?" : "Manage this community?"}
                </p>
                <Link
                  className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "shrink-0 whitespace-nowrap")}
                  href={profileClaimPath(profile.slug, "profile")}
                >
                  Claim profile
                </Link>
                {/* Offered to every reader of an unclaimed profile rather than
                    only to those who could act on it: this page is server
                    rendered with no viewer, and the editor handles sign-in. */}
                <Link
                  className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "shrink-0 whitespace-nowrap")}
                  href={`${profileBasePath}/edit`}
                >
                  Suggest an edit
                </Link>
              </div>
            ) : null}
          </aside>
        ) : null}

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
                  {/* Badge beside the provider name, matching the VRCDN row
                      below, so one surface does not carry two conventions. */}
                  <div className="flex items-center gap-3">
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
              <ProfileVrcdnStreams
                initialLiveStates={profile.vrcdnLive}
                profileSlug={profile.slug}
                streams={vrcdnStreams.map(({ label, stream }) => ({
                  label,
                  pcUrl: stream.pcUrl,
                  questUrl: stream.questUrl,
                  streamId: stream.streamId,
                }))}
              />
            </aside>
          ) : null}
        </div>

        {!isPerson && profile.telemetry ? <CommunityActivity telemetry={profile.telemetry} /> : null}

        {secondaryOrder.map((section) => {
          const content = secondarySections[section];
          return content ? <Fragment key={section}>{content}</Fragment> : null;
        })}

        <ProfilePrivateRecord profilePath={profileBasePath} slug={profile.slug} />
      </PageContainer>
    </PageShell>
  );
}
