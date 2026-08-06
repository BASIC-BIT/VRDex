"use client";

import { useConvex } from "convex/react";
import type { FunctionReference } from "convex/server";
import Link from "next/link";
import { useFeatureFlagEnabled, usePostHog } from "posthog-js/react";
import { type CSSProperties, useCallback, useEffect, useRef, useState, useTransition } from "react";

import { api } from "@convex-generated-api";
import { LookupCopyButton } from "./lookup-copy-button";
import { shouldRefreshBulkPrivateLookup } from "./lookup-private-refresh";
import { LookupSearchBox } from "./lookup-search-box";
import { mergeLookupSuggestions } from "./lookup-suggestion-merge";
import { SearchViewShell } from "./search-view-shell";
import { Card } from "@/components/ui/card";
import { EntityImage } from "@/components/ui/entity-image";
import { ProfileAvatarImage } from "@/components/ui/profile-avatar-image";
import { VerifiedTrustMark } from "@/components/ui/verified-trust-mark";
import { Table, TableCell, TableFrame, TableHead, TableHeaderCell } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { discordCopyValue } from "@/lib/discord-link";
import type { AvatarAppearance } from "@/lib/avatar-appearance";
import {
  captureProductEvent,
  mirrorPrivateSeedLookupAccess,
  PRIVATE_SEED_LOOKUP_UI_FLAG,
} from "@/lib/posthog";

type ProfileTrustLabel = "community_submitted" | "unclaimed" | "claimed_unverified" | "claimed_verified";
export type ProfileLookupLinkType =
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
type LookupStatus = "live" | "missing-url" | "error";
type OptionalPublicText = string | null | undefined;

type PublicProfileGenre = {
  slug: string;
  displayName: string;
  displayLabel?: OptionalPublicText;
  featured?: boolean;
};

export type PublicProfileLookupResult = {
  slug: string;
  displayName: string;
  profilePath: string;
  aliases: string[];
  tags: string[];
  genres: PublicProfileGenre[];
  roleTags: string[];
  headline?: OptionalPublicText;
  bio?: OptionalPublicText;
  avatarImageUrl?: OptionalPublicText;
  avatarImageKind?: "logo" | "profile";
  avatarAppearance?: AvatarAppearance;
  accentColor?: OptionalPublicText;
  secondaryColor?: OptionalPublicText;
  region?: OptionalPublicText;
  timezone?: OptionalPublicText;
  trustLabel: ProfileTrustLabel;
  sourceLabel?: string;
  outboundLinks: Array<{
    type: ProfileLookupLinkType;
    label: string;
    url: string;
    handle?: string;
    presentation?: LinkPresentation;
    source: LinkSource;
  }>;
};

export type SeedLookupViewerAccess = {
  allowed: boolean;
  source: "feature_grant" | "none" | "signed_out" | "super_admin";
};

export type PrivateSeedLookupResult = {
  id: string;
  displayName: string;
  proposedSlug?: string;
  reviewState: string;
  publicationState: "draft_private" | "review_pending" | "published_unclaimed";
  reviewedAt?: number;
  /**
   * Where the candidate went once it published.
   *
   * The lookup covers published records now, and naming a person it cannot take
   * you to is the smaller half of the surface that used to drop them entirely.
   */
  publishedProfileSlug?: string;
  source: {
    name: string;
    observedAt?: number;
  } | null;
  fields: Array<{
    id: string;
    fieldKey: string;
    value: unknown;
    sourceLabel: string;
    confidence: string;
    reviewState: string;
    visibility: string;
    sourceObservedAt?: number;
    lastCheckedAt?: number;
    reviewedAt?: number;
  }>;
};

export type ProfileLookupDisplayResult = PublicProfileLookupResult | PrivateSeedLookupResult;

export function isPrivateSeedLookupResult(
  result: ProfileLookupDisplayResult,
): result is PrivateSeedLookupResult {
  return "publicationState" in result;
}

export type BulkLookupEntry = {
  query: string;
  results: ProfileLookupDisplayResult[];
};

const seedAccessApi = (api as unknown as {
  seedAccess: {
    lookupPeople: FunctionReference<
      "query",
      "public",
      { query: string; limit?: number },
      PrivateSeedLookupResult[]
    >;
  };
}).seedAccess;

type LookupLink = PublicProfileLookupResult["outboundLinks"][number];

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function compactList(items: OptionalPublicText[]): string[] {
  return items.flatMap((item) => {
    const trimmed = item?.trim();

    return trimmed ? [trimmed] : [];
  });
}

function genreLabel(genre: PublicProfileGenre): string {
  return genre.displayLabel?.trim() || genre.displayName;
}

function genreToneClass(slug: string): string {
  if (slug.includes("drum-and-bass") || slug === "neurofunk") {
    return "lookup-genre-chip--dnb";
  }

  if (slug.includes("house")) {
    return "lookup-genre-chip--house";
  }

  if (slug.includes("techno") || slug.includes("midtempo")) {
    return "lookup-genre-chip--techno";
  }

  if (slug.includes("uk-garage")) {
    return "lookup-genre-chip--ukg";
  }

  if (slug.includes("trap") || slug === "140" || slug.includes("bass")) {
    return "lookup-genre-chip--bass";
  }

  return "lookup-genre-chip--default";
}

function dedupeProfiles(results: PublicProfileLookupResult[]): PublicProfileLookupResult[] {
  const profiles = new Map<string, PublicProfileLookupResult>();

  for (const result of results) {
    profiles.set(result.slug, result);
  }

  return [...profiles.values()];
}

function dedupePrivateSeeds(results: PrivateSeedLookupResult[]): PrivateSeedLookupResult[] {
  const candidates = new Map<string, PrivateSeedLookupResult>();

  for (const result of results) {
    candidates.set(result.id, result);
  }

  return [...candidates.values()];
}

function isVrcdnPreviewLink(link: LookupLink) {
  return link.type === "vrcdn" && (link.label.toLowerCase().includes("preview") || link.url.includes("panel.vrcdn.live"));
}

function isVrcdnStreamLink(link: LookupLink) {
  return link.type === "vrcdn" && !isVrcdnPreviewLink(link);
}

function vrcdnStreamName(url: string): string | undefined {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).at(-1)?.replace(/\.live\.ts$/, "");
  } catch {
    return undefined;
  }
}

function deriveVrcdnPreviewLink(url: string): { label: string; url: string } | null {
  const streamName = vrcdnStreamName(url);

  return streamName ? { label: "VRCDN preview", url: `https://panel.vrcdn.live/preview/${streamName}` } : null;
}

function deriveVrcdnCopyLinks(url: string): Array<{ label: string; value: string }> {
  try {
    const parsed = new URL(url);
    const streamName = vrcdnStreamName(url);

    if (!streamName) {
      return [{ label: "Quest MPEG-TS", value: url }];
    }

    return [
      { label: "Quest MPEG-TS", value: url },
      { label: "PC RTSPT", value: `rtspt://${parsed.hostname}/live/${streamName}` },
    ];
  } catch {
    return [{ label: "VRCDN stream", value: url }];
  }
}

function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 20 20">
      <path d="M7.25 4.25h8.5v8.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
      <path d="m15.25 4.75-10.5 10.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

function ProfileAvatar({ profile }: { profile: Pick<PublicProfileLookupResult, "avatarAppearance" | "avatarImageKind" | "avatarImageUrl" | "displayName"> }) {
  if (profile.avatarImageKind === "logo") {
    return (
      <EntityImage
        alt=""
        className="lookup-avatar lookup-avatar--logo"
        imageClassName="object-contain"
        label={profile.displayName}
        sizes="83px"
        src={profile.avatarImageUrl}
      />
    );
  }

  return (
    <ProfileAvatarImage
      alt=""
      appearance={profile.avatarAppearance}
      className="lookup-avatar"
      label={profile.displayName}
      sizes="83px"
      src={profile.avatarImageUrl}
    />
  );
}

function BrandIcon({ type }: { type: "discord" | "twitch" | "vrchat_profile" }) {
  if (type === "discord") {
    return (
      <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
      </svg>
    );
  }

  if (type === "twitch") {
    return (
      <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="size-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M22.732 6.767H1.268A1.27 1.27 0 0 0 0 8.035v5.296c0 .7.57 1.268 1.268 1.268h18.594l1.725 2.22c.215.275.443.415.68.415.153 0 .296-.06.403-.167.128-.129.193-.308.193-.536l-.002-1.939A1.27 1.27 0 0 0 24 13.331V8.035c0-.7-.569-1.269-1.268-1.269Zm.8 6.564a.8.8 0 0 1-.8.801h-.34v.031l.004 2.371c0 .155-.05.233-.129.233s-.19-.079-.31-.235l-1.866-2.4H1.268a.8.8 0 0 1-.8-.8V8.064a.8.8 0 0 1 .8-.8h21.464a.8.8 0 0 1 .8.8v5.266ZM4.444 8.573c-.127 0-.225.041-.254.15l-.877 3.129-.883-3.128c-.03-.11-.127-.15-.254-.15-.202 0-.473.126-.473.311 0 .012.005.035.011.058l1.114 3.63c.058.173.265.254.485.254s.433-.08.484-.254l1.109-3.63c.005-.023.011-.04.011-.058 0-.179-.27-.312-.473-.312Zm2.925 2.36c.433-.132.757-.49.757-1.153 0-.918-.612-1.207-1.368-1.207H5.614a.234.234 0 0 0-.242.231v3.752c0 .156.184.237.374.237s.376-.081.376-.237V11.05h.484l.82 1.593c.058.115.156.179.26.179.219 0 .467-.203.467-.393a.155.155 0 0 0-.028-.092l-.756-1.403Zm-.61-.473h-.636V9.231h.635c.375 0 .618.162.618.618s-.242.612-.618.612Zm10.056.826h1.004l-.502-1.772-.502 1.772Zm4.684-3.095H9.366a.8.8 0 0 0-.8.8v3.383a.8.8 0 0 0 .8.8h12.132a.8.8 0 0 0 .8-.8V8.992a.8.8 0 0 0-.8-.801Zm-10.946 3.977c.525 0 .571-.374.589-.617.011-.179.173-.236.369-.236.26 0 .38.075.38.369 0 .698-.57 1.142-1.379 1.142-.727 0-1.327-.357-1.327-1.322v-1.61c0-.963.606-1.322 1.333-1.322.802 0 1.374.427 1.374 1.097 0 .3-.121.37-.375.37-.214 0-.37-.064-.375-.238-.012-.178-.052-.57-.6-.57-.387 0-.606.213-.606.663v1.61c0 .45.219.664.617.664Zm4.703.388c0 .156-.19.237-.375.237s-.375-.081-.375-.237V10.9h-1.299v1.656c0 .156-.19.237-.375.237s-.375-.081-.375-.237V8.804c0-.161.185-.23.375-.23s.375.069.375.23v1.507h1.299V8.804c0-.161.185-.23.375-.23s.375.069.375.23v3.752Zm3.198.236c-.127 0-.225-.04-.254-.15l-.22-.768h-1.322l-.219.768c-.029.11-.127.15-.254.15-.202 0-.473-.127-.473-.311 0-.012.006-.035.012-.058l1.114-3.63c.051-.173.265-.254.478-.254s.433.08.485.254l1.114 3.63c.006.023.012.04.012.058 0 .179-.272.311-.473.311Zm2.989-3.543h-.843v3.306c0 .156-.19.237-.375.237s-.375-.081-.375-.237V9.25h-.848c-.15 0-.237-.157-.237-.34 0-.162.075-.336.237-.336h2.44c.162 0 .238.173.238.335 0 .18-.087.34-.237.34Z" />
    </svg>
  );
}

function LinkTypeIcon({ type }: { type: ProfileLookupLinkType }) {
  if (type === "discord" || type === "twitch" || type === "vrchat_profile") {
    return <BrandIcon type={type} />;
  }

  if (type === "soundcloud") {
    return (
      <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M9.2 17.5h9.1a3.7 3.7 0 0 0 0-7.4 4.9 4.9 0 0 0-9.6-1.2v8.6h.5Zm-2.4 0h1V9.4a5.4 5.4 0 0 0-1-.2v8.3Zm-2 0h1v-7.7a4.8 4.8 0 0 0-1 .9v6.8Zm-2 0h1v-5.4a4.8 4.8 0 0 0-1 .2v5.2Zm-2 0h1v-4.8a3.6 3.6 0 0 0-1 2.4v2.4Z" />
      </svg>
    );
  }

  if (type === "spotify") {
    return (
      <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
        <path d="M6.2 8.9c4.15-1.15 8.35-.7 11.9 1.3" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
        <path d="M7 12.1c3.18-.82 6.35-.45 9.05 1.08" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
        <path d="M7.65 15.05c2.48-.58 4.78-.32 6.82.78" stroke="currentColor" strokeLinecap="round" strokeWidth="1.65" />
      </svg>
    );
  }

  if (type === "youtube") {
    return (
      <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M21.6 7.2a2.8 2.8 0 0 0-2-2C17.9 4.8 12 4.8 12 4.8s-5.9 0-7.6.5a2.8 2.8 0 0 0-2 1.9A29.2 29.2 0 0 0 2 12a29.2 29.2 0 0 0 .5 4.8 2.8 2.8 0 0 0 1.9 2c1.7.4 7.6.4 7.6.4s5.9 0 7.6-.5a2.8 2.8 0 0 0 2-1.9A29.2 29.2 0 0 0 22 12a29.2 29.2 0 0 0-.4-4.8ZM10 15.1V8.9l5.2 3.1-5.2 3.1Z" />
      </svg>
    );
  }

  if (type === "bandcamp") {
    return (
      <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M7.1 6.5h14.1l-4.3 11H2.8l4.3-11Z" />
      </svg>
    );
  }

  if (type === "instagram") {
    return (
      <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
        <rect width="15" height="15" x="4.5" y="4.5" stroke="currentColor" strokeWidth="2" rx="4" />
        <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="2" />
        <circle cx="16.8" cy="7.3" r="1" fill="currentColor" />
      </svg>
    );
  }

  if (type === "mixcloud") {
    return (
      <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M8.4 17.5h9.1a3.5 3.5 0 0 0 .4-7A5.7 5.7 0 0 0 7 8.6 4.5 4.5 0 0 0 8.4 17.5Zm0-2a2.5 2.5 0 1 1 .4-5l.8.1.3-.8a3.7 3.7 0 0 1 7.2 1.2v1.3h.6a1.6 1.6 0 0 1-.2 3.2H8.4Z" />
      </svg>
    );
  }

  if (type === "commissions") {
    return (
      <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
        <path d="M6 8h12v11H6z" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
        <path d="M9 8V6.8A2.8 2.8 0 0 1 11.8 4h.4A2.8 2.8 0 0 1 15 6.8V8" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
      </svg>
    );
  }

  return <ExternalIcon className="size-5" />;
}

function LookupStatusNotice({ status }: { status: LookupStatus }) {
  if (status === "live") {
    return null;
  }

  return (
    <Card surface="dashed">
      {status === "missing-url" ? "Lookup data is not available in this environment yet." : "Lookup data is temporarily unavailable."}
    </Card>
  );
}

function IconCircleLink({ link, className }: { link: LookupLink; className?: string }) {
  return (
    <a
      aria-label={link.handle ? `${link.label}: ${link.handle}` : `${link.label}: ${hostLabel(link.url)}`}
      className={cn("lookup-brand-circle", `lookup-brand-circle--${link.type}`, className)}
      href={link.url}
      rel="noreferrer"
      target="_blank"
      title={link.handle ? `${link.label}: ${link.handle}` : `${link.label}: ${hostLabel(link.url)}`}
    >
      <LinkTypeIcon type={link.type} />
    </a>
  );
}

function VrcdnPreviewLink({ link }: { link: { label: string; url: string } }) {
  return (
    <a aria-label={link.label} className="lookup-feature-link" href={link.url} rel="noreferrer" target="_blank">
      <span className="lookup-feature-link__label">{link.label}</span>
      <ExternalIcon className="size-4" />
    </a>
  );
}

function CopyableUrlBar({
  className,
  label,
  labelCh,
  value,
  valueCh,
}: {
  className?: string;
  label: string;
  labelCh?: number;
  value: string;
  valueCh?: number;
}) {
  const urlInputCh = Math.min(Math.max(valueCh ?? value.length, 18), 68);
  const labelWidthCh = Math.max(labelCh ?? label.length, label.length);

  return (
    <div
      className={cn("lookup-primary-url-card", className)}
      style={{ "--lookup-label-ch": labelWidthCh, "--lookup-url-ch": urlInputCh } as CSSProperties}
    >
      <span className="lookup-primary-url-label">{label}</span>
      <input
        aria-label={`${label} URL`}
        className="lookup-primary-url-value"
        readOnly
        title={value}
        value={value}
        onClick={(event) => event.currentTarget.select()}
        onFocus={(event) => event.currentTarget.select()}
      />
      <LookupCopyButton className="lookup-primary-url-copy" label="Copy" value={value} />
    </div>
  );
}

function TwitchFeatureLink({ labelCh, link, valueCh }: { labelCh: number; link: LookupLink; valueCh: number }) {
  return (
    <CopyableUrlBar
      className="lookup-primary-url-card--twitch"
      label="Twitch"
      labelCh={labelCh}
      value={link.url}
      valueCh={valueCh}
    />
  );
}

function CodeCopyBar({
  label,
  labelCh,
  value,
  valueCh,
}: {
  label: string;
  labelCh: number;
  value: string;
  valueCh: number;
}) {
  return <CopyableUrlBar label={label} labelCh={labelCh} value={value} valueCh={valueCh} />;
}

function LookupLinks({ links }: { links: PublicProfileLookupResult["outboundLinks"] }) {
  if (links.length === 0) {
    return <span className="text-muted">No public links</span>;
  }

  const explicitVrcdnPreviewLinks = links.filter(isVrcdnPreviewLink);
  const vrcdnStreamLinks = links.filter(isVrcdnStreamLink);
  const twitchCopyLinks = links.filter((link) => link.type === "twitch" && link.presentation === "copy");
  const discordCopyLinks = links.flatMap((link) => {
    if (link.type !== "discord") {
      return [];
    }

    const value = discordCopyValue(link);

    return value ? [{ key: `${link.type}-${link.url}`, label: "Discord", value }] : [];
  });
  const vrcdnPreviewLinks = [
    ...explicitVrcdnPreviewLinks.map((link) => ({ label: link.label, url: link.url })),
    ...vrcdnStreamLinks.flatMap((link) => {
      const previewLink = deriveVrcdnPreviewLink(link.url);

      return previewLink ? [previewLink] : [];
    }),
  ].filter((link, index, allLinks) => allLinks.findIndex((candidate) => candidate.url === link.url) === index);
  const handled = new Set([
    ...explicitVrcdnPreviewLinks,
    ...vrcdnStreamLinks,
    ...twitchCopyLinks,
    ...links.filter((link) => link.type === "discord" && discordCopyValue(link) !== null),
  ]);
  const iconLinks = links.filter((link) => !handled.has(link));
  const vrcdnCopyLinks = vrcdnStreamLinks.flatMap((link) => deriveVrcdnCopyLinks(link.url).map((entry) => ({ ...entry, key: `${link.url}-${entry.label}` })));
  const copyRows = [
    ...discordCopyLinks,
    ...vrcdnCopyLinks,
    ...twitchCopyLinks.map((link) => ({ key: `${link.type}-${link.url}`, label: "Twitch", value: link.url })),
  ];
  const copyValueCh = Math.max(18, ...copyRows.map((row) => row.value.length));
  const copyLabelCh = Math.max(0, ...copyRows.map((row) => row.label.length));
  const hasPrimaryActions = vrcdnPreviewLinks.length > 0 || iconLinks.length > 0;
  const hasCopyRows = copyRows.length > 0;
  const linkBoardStyle = hasCopyRows
    ? ({ "--lookup-board-label-ch": copyLabelCh, "--lookup-board-url-ch": Math.min(Math.max(copyValueCh, 18), 68) } as CSSProperties)
    : undefined;

  return (
    <div className={cn("lookup-link-board", hasCopyRows ? "lookup-link-board--copy-aligned" : undefined)} style={linkBoardStyle}>
      {hasPrimaryActions ? (
        <div className="lookup-link-actions">
          {iconLinks.length > 0 ? (
            <div className="lookup-icon-actions">
              {iconLinks.map((link) => <IconCircleLink key={`${link.type}-${link.url}`} link={link} />)}
            </div>
          ) : null}
          {vrcdnPreviewLinks.map((link) => <VrcdnPreviewLink key={link.url} link={link} />)}
        </div>
      ) : null}
      {hasCopyRows ? (
        <div className="lookup-copy-list">
          {discordCopyLinks.map((entry) => (
            <CodeCopyBar
              key={entry.key}
              label={entry.label}
              labelCh={copyLabelCh}
              value={entry.value}
              valueCh={copyValueCh}
            />
          ))}
          {vrcdnCopyLinks.map((entry) => (
            <CodeCopyBar
              key={entry.key}
              label={entry.label}
              labelCh={copyLabelCh}
              value={entry.value}
              valueCh={copyValueCh}
            />
          ))}
          {twitchCopyLinks.map((link) => (
            <TwitchFeatureLink
              key={`${link.type}-${link.url}`}
              labelCh={copyLabelCh}
              link={link}
              valueCh={copyValueCh}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LookupGenres({ genres }: { genres: PublicProfileGenre[] }) {
  const visibleGenres = genres.filter((genre) => genreLabel(genre));
  const accessibleLabel = visibleGenres.map(genreLabel).join(", ");

  if (visibleGenres.length === 0) {
    return null;
  }

  return (
    <div aria-label={accessibleLabel} className="lookup-genre-line">
      <span aria-hidden="true" className="lookup-genre-list">
        {visibleGenres.map((genre) => (
          <span
            className={cn(
              "lookup-genre-chip",
              genreToneClass(genre.slug),
              genre.featured ? "lookup-genre-chip--featured" : undefined,
            )}
            key={genre.slug}
          >
            {genreLabel(genre)}
          </span>
        ))}
      </span>
    </div>
  );
}

function lookupIdentityStyle(profile: PublicProfileLookupResult): CSSProperties | undefined {
  const accentColor = profile.accentColor?.trim();

  if (!accentColor) {
    return undefined;
  }

  return {
    "--lookup-profile-accent": accentColor,
    "--lookup-profile-secondary": profile.secondaryColor?.trim() || accentColor,
  } as CSSProperties;
}

function LookupIdentity({ profile }: { profile: PublicProfileLookupResult }) {
  const hasFlair = Boolean(profile.accentColor?.trim());
  const identityMeta = compactList([profile.region, profile.timezone]).join(" / ");
  return (
    <div
      className={cn("lookup-identity", hasFlair ? "lookup-identity--flair" : undefined)}
      style={lookupIdentityStyle(profile)}
    >
      <div className="lookup-avatar-wrap">
        <ProfileAvatar profile={profile} />
        {profile.trustLabel === "claimed_verified" ? <VerifiedTrustMark className="verified-trust-mark--avatar" /> : null}
      </div>
      <div className="lookup-identity-copy">
        <div className="lookup-name-row">
          <Link className="lookup-name-link" href={profile.profilePath}>
            {profile.displayName}
          </Link>
        </div>
        {profile.aliases.length > 0 ? (
          <div className="lookup-alias-line">
            <span>aka</span>
            <span className="lookup-alias-line__value">{profile.aliases.join(" / ")}</span>
          </div>
        ) : null}
        {identityMeta ? <div className="lookup-identity-meta">{identityMeta}</div> : null}
      </div>
    </div>
  );
}

function LookupResultRow({ profile }: { profile: PublicProfileLookupResult }) {
  return (
    <tr className="lookup-result-row align-middle">
      <TableCell className="lookup-name-cell px-2 py-2">
        <LookupIdentity profile={profile} />
      </TableCell>
      <TableCell className="lookup-genre-cell px-2 py-2">
        <LookupGenres genres={profile.genres} />
      </TableCell>
      <TableCell className="lookup-links-cell px-2 py-2">
        <LookupLinks links={profile.outboundLinks} />
      </TableCell>
    </tr>
  );
}

function LookupResultCard({ profile }: { profile: PublicProfileLookupResult }) {
  return (
    <Card className="lookup-result-card grid gap-2" padding="sm">
      <LookupIdentity profile={profile} />
      <div className="text-xs">
        <LookupGenres genres={profile.genres} />
      </div>
      <LookupLinks links={profile.outboundLinks} />
    </Card>
  );
}

function privateFieldValue<T>(candidate: PrivateSeedLookupResult, fieldKey: string): T | undefined {
  return candidate.fields.find((field) => field.fieldKey === fieldKey)?.value as T | undefined;
}

function privateSeedLinks(candidate: PrivateSeedLookupResult): PublicProfileLookupResult["outboundLinks"] {
  const links = privateFieldValue<Array<Omit<LookupLink, "source">>>(candidate, "outboundLinks");

  return Array.isArray(links)
    ? links.map((link) => ({ ...link, source: "partner_provided" as const }))
    : [];
}

function privateSeedGenres(candidate: PrivateSeedLookupResult): PublicProfileGenre[] {
  const genres = privateFieldValue<string[]>(candidate, "genres");

  return Array.isArray(genres)
    ? genres.map((displayName) => ({
        displayName,
        slug: displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      }))
    : [];
}

function PrivateSeedIdentity({ candidate }: { candidate: PrivateSeedLookupResult }) {
  const aliases = privateFieldValue<string[]>(candidate, "aliases") ?? [];

  return (
    <div className="lookup-private-identity ph-no-capture" data-ph-no-capture>
      {/* Linked once it has somewhere to go. A published candidate whose public
          search result does not match what the operator typed would otherwise be
          named here and nowhere else. */}
      {candidate.publishedProfileSlug ? (
        <Link className="lookup-private-name" href={`/p/${candidate.publishedProfileSlug}`}>
          {candidate.displayName}
        </Link>
      ) : (
        <span className="lookup-private-name">{candidate.displayName}</span>
      )}
      {aliases.length > 0 ? (
        <div className="lookup-alias-line">
          <span>aka</span>
          <span className="lookup-alias-line__value">{aliases.join(" / ")}</span>
        </div>
      ) : null}
    </div>
  );
}

function PrivateSeedResultRow({ candidate }: { candidate: PrivateSeedLookupResult }) {
  return (
    <tr className="lookup-result-row ph-no-capture align-middle" data-ph-no-capture>
      <TableCell className="lookup-name-cell px-2 py-2">
        <PrivateSeedIdentity candidate={candidate} />
      </TableCell>
      <TableCell className="lookup-genre-cell px-2 py-2">
        <LookupGenres genres={privateSeedGenres(candidate)} />
      </TableCell>
      <TableCell className="lookup-links-cell px-2 py-2">
        <LookupLinks links={privateSeedLinks(candidate)} />
      </TableCell>
    </tr>
  );
}

function PrivateSeedResultCard({ candidate }: { candidate: PrivateSeedLookupResult }) {
  return (
    <Card
      className="lookup-result-card ph-no-capture grid gap-2"
      data-ph-no-capture
      padding="sm"
    >
      <PrivateSeedIdentity candidate={candidate} />
      <div className="text-xs"><LookupGenres genres={privateSeedGenres(candidate)} /></div>
      <LookupLinks links={privateSeedLinks(candidate)} />
    </Card>
  );
}

function BulkLookupSummary({ entries }: { entries: BulkLookupEntry[] }) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <Card
      className="lookup-panel lookup-bulk-summary ph-no-capture grid gap-2"
      data-ph-no-capture
      padding="sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-[-0.03em]">Lineup matches</h2>
        <span className="text-xs text-muted">{entries.length} pasted entries</span>
      </div>
      <div className="lookup-bulk-grid">
        {entries.map((entry) => (
          <div className="lookup-bulk-row" key={entry.query}>
            <span className="font-mono text-xs text-muted">{entry.query}</span>
            <span className="text-sm">
              {entry.results.length === 0
                ? "No match"
                : entry.results.map((result) => result.displayName).join(" / ")}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

type LookupResponse = {
  privateResults: PrivateSeedLookupResult[];
  results: PublicProfileLookupResult[];
  viewerAccess: SeedLookupViewerAccess;
};

async function fetchLookupResults(query: string): Promise<LookupResponse> {
  const response = await fetch(`/lookup/suggest?q=${encodeURIComponent(query)}`, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Lookup request failed.");
  }

  const data = await response.json() as LookupResponse;

  return data;
}

function updateLookupUrl(query: string, routePath: "/" | "/lookup" | "/search", view?: "dj") {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }
  if (view) {
    params.set("view", view);
  }
  const nextUrl = params.size > 0 ? `${routePath}?${params.toString()}` : routePath;

  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (currentUrl !== nextUrl) {
    window.history.pushState(null, "", nextUrl);
  }
}

type ProfileLookupPageProps = {
  privateResults: PrivateSeedLookupResult[];
  query: string;
  results: PublicProfileLookupResult[];
  routePath?: "/" | "/lookup" | "/search";
  status: LookupStatus;
  view?: "dj";
  viewerAccess: SeedLookupViewerAccess;
};

type QueryPrivateResults = (
  query: string,
) => Promise<PrivateSeedLookupResult[]>;

export function ProfileLookupPage({
  privateResults,
  query,
  results,
  routePath = "/lookup",
  status,
  view,
  viewerAccess,
}: ProfileLookupPageProps) {
  const props = { privateResults, query, results, routePath, status, view, viewerAccess };

  return process.env.NEXT_PUBLIC_CONVEX_URL
    ? <ConnectedProfileLookupPage {...props} />
    : <ProfileLookupPageContent {...props} queryPrivateResults={null} />;
}

function ConnectedProfileLookupPage(props: ProfileLookupPageProps) {
  const convex = useConvex();
  const queryPrivateResults = useCallback(
    async (query: string) => await convex.query(seedAccessApi.lookupPeople, {
      query,
      limit: 12,
    }),
    [convex],
  );

  return <ProfileLookupPageContent {...props} queryPrivateResults={queryPrivateResults} />;
}

function ProfileLookupPageContent({
  privateResults,
  query,
  queryPrivateResults,
  results,
  routePath = "/lookup",
  status,
  view,
  viewerAccess,
}: ProfileLookupPageProps & { queryPrivateResults: QueryPrivateResults | null }) {
  const posthog = usePostHog();
  const privateUiFlag = useFeatureFlagEnabled(PRIVATE_SEED_LOOKUP_UI_FLAG);
  const [displayQuery, setDisplayQuery] = useState(query);
  const [displayResults, setDisplayResults] = useState(results);
  const [displayPrivateResults, setDisplayPrivateResults] = useState(privateResults);
  const [seedViewerAccess, setSeedViewerAccess] = useState(viewerAccess);
  const [lookupStatus, setLookupStatus] = useState<LookupStatus>(status);
  const [bulkEntries, setBulkEntries] = useState<BulkLookupEntry[]>([]);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const privateLookupQueryRef = useRef<string | null>(
    privateResults.length > 0 ? query : null,
  );
  const bulkLookupLinesRef = useRef<string[]>([]);
  const bulkPrivateRefreshAttemptedRef = useRef(privateUiFlag === true);
  const [isPending, startTransition] = useTransition();
  const isSearching = pendingLabel !== null || isPending;
  const privateUiEnabled = seedViewerAccess.source === "super_admin" || privateUiFlag === true;
  const visibleResults = mergeLookupSuggestions(
    displayResults,
    seedViewerAccess.allowed && privateUiEnabled ? displayPrivateResults : [],
  );
  const visiblePublicResults = visibleResults.filter(
    (result): result is PublicProfileLookupResult => !isPrivateSeedLookupResult(result),
  );
  const visiblePrivateResults = visibleResults.filter(isPrivateSeedLookupResult);
  const seedViewerAccessAllowed = seedViewerAccess.allowed;
  const seedViewerAccessSource = seedViewerAccess.source;
  const hasQuery = Boolean(displayQuery.trim()) || bulkEntries.length > 0 || isSearching;

  useEffect(() => {
    const handleHistoryNavigation = () => window.location.reload();
    window.addEventListener("popstate", handleHistoryNavigation);
    return () => window.removeEventListener("popstate", handleHistoryNavigation);
  }, []);

  useEffect(() => {
    mirrorPrivateSeedLookupAccess(posthog, seedViewerAccess.allowed);
  }, [posthog, seedViewerAccess.allowed]);

  useEffect(() => {
    if (visiblePrivateResults.length === 0) {
      return;
    }

    captureProductEvent(posthog, "private_seed_results_shown", {
      result_count: visiblePrivateResults.length === 1 ? "one" : "multiple",
      ui_flag: seedViewerAccess.source === "super_admin" ? "super_admin_bypass" : "enabled",
    });
  }, [displayQuery, posthog, seedViewerAccess.source, visiblePrivateResults.length]);

  const fetchAllowedPrivateResults = useCallback(async (
    nextLookup: LookupResponse,
    nextQuery: string,
  ) => {
    const enabled = nextLookup.viewerAccess.source === "super_admin" || privateUiFlag === true;

    if (!nextLookup.viewerAccess.allowed || !enabled) {
      return [];
    }

    if (nextLookup.privateResults.length > 0) {
      return nextLookup.privateResults;
    }

    if (!queryPrivateResults) {
      return [];
    }

    privateLookupQueryRef.current = nextQuery;
    try {
      return await queryPrivateResults(nextQuery);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Client-side private seed lookup failed: ${message}`);
      return [];
    }
  }, [privateUiFlag, queryPrivateResults]);

  useEffect(() => {
    const currentQuery = displayQuery.trim();
    const enabled = seedViewerAccess.source === "super_admin" || privateUiFlag === true;

    if (
      bulkEntries.length > 0 ||
      currentQuery.length < 1 ||
      displayPrivateResults.length > 0 ||
      !seedViewerAccess.allowed ||
      !enabled ||
      !queryPrivateResults ||
      privateLookupQueryRef.current === currentQuery
    ) {
      return;
    }

    let cancelled = false;
    const requestVersion = requestVersionRef.current;
    privateLookupQueryRef.current = currentQuery;

    void queryPrivateResults(currentQuery)
      .then((initialPrivateResults) => {
        if (!cancelled && requestVersionRef.current === requestVersion) {
          startTransition(() => setDisplayPrivateResults(initialPrivateResults));
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Client-side private seed lookup failed: ${message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [
    bulkEntries.length,
    displayPrivateResults.length,
    displayQuery,
    privateUiFlag,
    queryPrivateResults,
    seedViewerAccess.allowed,
    seedViewerAccess.source,
  ]);

  const runLookup = useCallback(async (nextQuery: string) => {
    const normalizedQuery = nextQuery.trim();

    if (!normalizedQuery) {
      return;
    }

    const requestVersion = requestVersionRef.current + 1;

    requestVersionRef.current = requestVersion;
    setPendingLabel(`Searching ${normalizedQuery}`);
    captureProductEvent(posthog, "lookup_submitted", {
      access_scope: seedViewerAccess.allowed && privateUiEnabled
        ? "private_and_public"
        : "public_only",
      mode: "single",
      view_key: "dj",
    });

    try {
      const nextLookup = await fetchLookupResults(normalizedQuery);
      const nextPrivateResults = await fetchAllowedPrivateResults(
        nextLookup,
        normalizedQuery,
      );

      if (requestVersionRef.current !== requestVersion) {
        return;
      }

      startTransition(() => {
        setDisplayQuery(normalizedQuery);
        setDisplayResults(nextLookup.results);
        setDisplayPrivateResults(nextPrivateResults);
        setSeedViewerAccess(nextLookup.viewerAccess);
        setLookupStatus("live");
        setBulkEntries([]);
        updateLookupUrl(normalizedQuery, routePath, view);
      });
    } catch {
      if (requestVersionRef.current === requestVersion) {
        setLookupStatus("error");
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setPendingLabel(null);
      }
    }
  }, [fetchAllowedPrivateResults, posthog, privateUiEnabled, routePath, seedViewerAccess.allowed, view]);

  const runBulkLookup = useCallback(async (
    lines: string[],
    options: { flagRefresh?: boolean } = {},
  ) => {
    bulkLookupLinesRef.current = lines;
    if (!options.flagRefresh) {
      bulkPrivateRefreshAttemptedRef.current = privateUiFlag === true;
    }
    if (lines.length === 0) {
      requestVersionRef.current += 1;
      startTransition(() => {
        setBulkEntries([]);
        setDisplayQuery("");
        setDisplayResults([]);
        setDisplayPrivateResults([]);
        setLookupStatus("live");
        updateLookupUrl("", routePath, view);
      });
      return;
    }

    const requestVersion = requestVersionRef.current + 1;

    requestVersionRef.current = requestVersion;
    setPendingLabel(`Searching ${lines.length} lineup entries`);
    captureProductEvent(posthog, "lookup_submitted", {
      access_scope: seedViewerAccessAllowed && privateUiEnabled
        ? "private_and_public"
        : "public_only",
      mode: "bulk",
      view_key: "dj",
    });

    try {
      const entries = await Promise.all(
        lines.map(async (line) => {
          const lookup = await fetchLookupResults(line);
          const privateResults = await fetchAllowedPrivateResults(lookup, line);
          const showPrivate = lookup.viewerAccess.allowed && (
            lookup.viewerAccess.source === "super_admin" || privateUiFlag === true
          );

          return {
            lookup: { ...lookup, privateResults },
            query: line,
            results: mergeLookupSuggestions(
              lookup.results,
              showPrivate ? privateResults : [],
            ),
          };
        }),
      );
      const nextResults = dedupeProfiles(entries.flatMap((entry) => entry.lookup.results));
      const nextPrivateResults = dedupePrivateSeeds(
        entries.flatMap((entry) => entry.lookup.privateResults),
      );
      const nextViewerAccess = entries[0]?.lookup.viewerAccess ?? {
        allowed: seedViewerAccessAllowed,
        source: seedViewerAccessSource,
      };

      if (requestVersionRef.current !== requestVersion) {
        return;
      }

      startTransition(() => {
        setBulkEntries(
          entries.map(({ query: entryQuery, results: entryResults }) => ({
            query: entryQuery,
            results: entryResults,
          })),
        );
        setDisplayQuery(`${lines.length} lineup entries`);
        setDisplayResults(nextResults);
        setDisplayPrivateResults(nextViewerAccess.allowed ? nextPrivateResults : []);
        setSeedViewerAccess(nextViewerAccess);
        setLookupStatus("live");
        updateLookupUrl("", routePath, view);
      });
    } catch {
      if (requestVersionRef.current === requestVersion) {
        setLookupStatus("error");
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setPendingLabel(null);
      }
    }
  }, [
    fetchAllowedPrivateResults,
    posthog,
    privateUiEnabled,
    privateUiFlag,
    routePath,
    seedViewerAccessAllowed,
    seedViewerAccessSource,
    view,
  ]);

  useEffect(() => {
    const lines = bulkLookupLinesRef.current;
    if (!shouldRefreshBulkPrivateLookup({
      bulkEntryCount: bulkEntries.length,
      flagEnabled: privateUiFlag === true,
      lineCount: lines.length,
      refreshAttempted: bulkPrivateRefreshAttemptedRef.current,
    })) {
      return;
    }

    bulkPrivateRefreshAttemptedRef.current = true;
    void runBulkLookup(lines, { flagRefresh: true });
  }, [bulkEntries.length, privateUiFlag, runBulkLookup]);

  const clearLookup = useCallback(() => {
    requestVersionRef.current += 1;
    bulkLookupLinesRef.current = [];
    bulkPrivateRefreshAttemptedRef.current = privateUiFlag === true;
    startTransition(() => {
      setDisplayQuery("");
      setDisplayResults([]);
      setDisplayPrivateResults([]);
      setBulkEntries([]);
      setLookupStatus("live");
      setPendingLabel(null);
      updateLookupUrl("", routePath, view);
    });
  }, [privateUiFlag, routePath, view]);

  const canonicalView = view ?? "dj";
  const switcherQuery = bulkEntries.length > 0 ? undefined : displayQuery;

  return (
    <SearchViewShell
      activeView={canonicalView}
      className="lookup-theme"
      query={switcherQuery}
      searchControl={(
        <LookupSearchBox
          actionPath={routePath}
          initialQuery={displayQuery}
          initialResults={visibleResults}
          isSearching={isSearching}
          onBulkLookup={runBulkLookup}
          onClear={clearLookup}
          onLookup={runLookup}
          showPrivateSuggestions={seedViewerAccess.allowed && privateUiEnabled}
          view={view}
        />
      )}
    >
        <LookupStatusNotice status={lookupStatus} />

        {hasQuery ? (
          <section aria-label="Lookup results" className="grid gap-3">
            {isSearching ? <span className="sr-only">{pendingLabel ?? "Searching"}</span> : null}
            <BulkLookupSummary entries={bulkEntries} />
            <div className={cn("lookup-results-wrap", isSearching ? "lookup-results-wrap--pending" : undefined)}>
              {visiblePublicResults.length === 0 && visiblePrivateResults.length === 0 && !isSearching ? (
                <Card className="lookup-panel" surface="dashed">
                  <p className="font-medium">No matches found.</p>
                </Card>
              ) : visiblePublicResults.length > 0 || visiblePrivateResults.length > 0 ? (
                <>
                  <div className="grid gap-3 min-[1320px]:hidden">
                    {visiblePublicResults.map((profile) => <LookupResultCard key={profile.slug} profile={profile} />)}
                    {visiblePrivateResults.map((candidate) => (
                      <PrivateSeedResultCard candidate={candidate} key={candidate.id} />
                    ))}
                  </div>
                  <TableFrame className="lookup-table hidden min-[1320px]:block">
                    <Table>
                      <TableHead>
                        <tr>
                          <TableHeaderCell>Name</TableHeaderCell>
                          <TableHeaderCell>Genres</TableHeaderCell>
                          <TableHeaderCell>Links</TableHeaderCell>
                        </tr>
                      </TableHead>
                      <tbody className="divide-y divide-border">
                        {visiblePublicResults.map((profile) => <LookupResultRow key={profile.slug} profile={profile} />)}
                        {visiblePrivateResults.map((candidate) => (
                          <PrivateSeedResultRow candidate={candidate} key={candidate.id} />
                        ))}
                      </tbody>
                    </Table>
                  </TableFrame>
                </>
              ) : null}
            </div>
          </section>
        ) : null}
    </SearchViewShell>
  );
}
