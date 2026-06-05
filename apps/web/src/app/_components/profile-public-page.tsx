import Link from "next/link";

import { EventPreviewCard, type PublicEventPreview } from "./event-public-page";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow, SectionHeading, SectionTitle } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { cn } from "@/lib/cn";
import { safeImageBackground } from "@/lib/safe-image";

type ProfileTrustLabel =
  | "community_submitted"
  | "unclaimed"
  | "claimed_unverified"
  | "claimed_verified";
type ProfileLinkType =
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
type WorldCreatorRole =
  | "world_author"
  | "builder"
  | "venue_operator"
  | "community_operator"
  | "media_credit"
  | "storefront_owner";

type PublicProfileBase = {
  profileType: "person" | "community";
  slug: string;
  displayName: string;
  aliases: string[];
  tags: string[];
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
  const avatarStyle = safeImageBackground(profile.avatarImageUrl);
  const sourceSubmittedAt = formatSubmittedAt(profile.source?.submittedAt);
  const sourceDetails = [
    profile.source && profile.source.label !== trust ? profile.source.label : null,
    sourceSubmittedAt,
  ].filter((value): value is string => Boolean(value));

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
                    className="flex size-24 items-center justify-center rounded-panel border border-white/35 bg-white/20 bg-cover bg-center text-3xl font-semibold shadow-panel"
                    style={avatarStyle}
                    role="img"
                    aria-label={`${profile.displayName} display image`}
                  >
                    {!avatarStyle ? initialsFor(profile.displayName) : null}
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

        <Card>
          <SectionHeading>
            {isPerson ? "Upcoming events" : "Hosted events"}
          </SectionHeading>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {(isPerson ? profile.upcomingEvents : profile.hostedEvents).length === 0 ? (
              <p className="text-sm leading-6 text-muted">No public upcoming events yet.</p>
            ) : (
              (isPerson ? profile.upcomingEvents : profile.hostedEvents).map((event) => (
                <EventPreviewCard event={event} key={`${event.slug ?? event.title}-${event.startAt}`} />
              ))
            )}
          </div>
        </Card>

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
                    {host ? <span className="mt-1 block text-xs text-muted">{host}</span> : null}
                  </a>
                );
              })
            )}
          </div>
        </Card>

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
      </PageContainer>
    </PageShell>
  );
}
