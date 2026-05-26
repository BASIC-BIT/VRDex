import Link from "next/link";

import { EventPreviewCard, type PublicEventPreview } from "./event-public-page";

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
    return {
      title: "Verified owner",
      description: "This profile is controlled by its owner and has stronger verification.",
    };
  }

  if (label === "claimed_unverified") {
    return {
      title: "Claimed",
      description: "This profile is owner-controlled, with stronger verification still pending.",
    };
  }

  if (label === "community_submitted") {
    return {
      title: "Community submitted",
      description: "This profile was added by a signed-in community member and has not been claimed yet.",
    };
  }

  return {
    title: "Unclaimed",
    description: "No owner authority has been attached to this profile yet.",
  };
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

function safeImageBackground(imageUrl: string | undefined, overlay = false) {
  if (!imageUrl) {
    return undefined;
  }

  try {
    const url = new URL(imageUrl);

    if (url.protocol !== "https:") {
      return undefined;
    }

    const image = `url(${JSON.stringify(url.href)})`;

    return {
      backgroundImage: overlay
        ? `linear-gradient(135deg, rgba(22, 17, 15, 0.58), rgba(214, 106, 77, 0.2)), ${image}`
        : image,
    };
  } catch {
    return undefined;
  }
}

function safeHttpsUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function linkSourceLabel(source: LinkSource): string {
  if (source === "owner_authored") {
    return "Owner-authored";
  }

  if (source === "partner_provided") {
    return "Partner-provided";
  }

  return "Reviewed";
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
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          className="rounded-full border border-border bg-surface-strong px-3 py-1 text-sm"
          key={item}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function ProfileBackendNotice({ kind }: { kind: "missing-url" | "error" }) {
  return (
    <main className="min-h-screen px-6 py-10 text-foreground sm:px-10 lg:px-16">
      <section className="mx-auto max-w-3xl rounded-[2rem] border border-border bg-surface px-6 py-8 shadow-[0_24px_80px_rgba(64,40,24,0.12)] sm:px-8">
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
          Public profile
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">
          {kind === "missing-url" ? "Convex URL not configured" : "Profile read failed"}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">
          {kind === "missing-url"
            ? "Run the local backend bootstrap before loading public profile pages from this worktree."
            : "Start the local Convex backend and reload this page once the profile query is reachable."}
        </p>
        <Link
          className="mt-6 inline-flex rounded-full border border-border bg-surface-strong px-5 py-3 text-sm font-medium"
          href="/"
        >
          Back to homepage
        </Link>
      </section>
    </main>
  );
}

export function ProfilePublicPage({ profile }: { profile: PublicProfile }) {
  const trust = trustLabelCopy(profile.trustLabel);
  const isPerson = profile.profileType === "person";
  const routePrefix = isPerson ? "p" : "c";
  const typeLabel = isPerson ? "Person profile" : "Community profile";
  const typeItems: string[] = isPerson
    ? profile.person.roleTags
    : [profile.community.subtype, ...profile.community.categoryTags].filter(
        (item): item is string => Boolean(item),
      );
  const bannerStyle = safeImageBackground(profile.bannerImageUrl, true);
  const avatarStyle = safeImageBackground(profile.avatarImageUrl);

  return (
    <main className="min-h-screen px-6 py-8 text-foreground sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <nav className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link className="font-mono uppercase tracking-[0.28em] text-muted" href="/">
            VRDex
          </Link>
          <Link
            className="rounded-full border border-border bg-surface px-4 py-2 font-medium"
            href="/submit"
          >
            Add a missing profile
          </Link>
        </nav>

        <section className="overflow-hidden rounded-[2rem] border border-border bg-surface shadow-[0_24px_80px_rgba(64,40,24,0.12)] backdrop-blur">
          <div
            className="min-h-64 bg-[radial-gradient(circle_at_top_left,rgba(214,106,77,0.26),transparent_34%),linear-gradient(135deg,#2f211b,#9f3f27)] bg-cover bg-center p-6 text-white sm:p-8 lg:p-10"
            style={bannerStyle}
          >
            <div className="flex min-h-52 flex-col justify-between gap-10">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-white/15 px-3 py-1 font-mono text-xs uppercase tracking-[0.22em] text-white/82">
                  {typeLabel}
                </span>
                <span className="rounded-full bg-white/15 px-3 py-1 font-mono text-xs uppercase tracking-[0.22em] text-white/82">
                  /{routePrefix}/{profile.slug}
                </span>
              </div>

              <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
                <div className="flex flex-col gap-4">
                  <div
                    className="flex size-24 items-center justify-center rounded-[1.75rem] border border-white/35 bg-white/20 bg-cover bg-center text-3xl font-semibold shadow-[0_18px_60px_rgba(0,0,0,0.22)]"
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
                    <p className="mt-4 max-w-2xl text-base leading-7 text-white/82 sm:text-lg">
                      {profile.headline ??
                        profile.bio ??
                        (isPerson
                          ? "A public VRDex identity page for a VRChat scene person."
                          : "A public VRDex home for a VRChat scene community.")}
                    </p>
                  </div>
                </div>

                <aside className="rounded-[1.5rem] border border-white/20 bg-white/14 p-4 backdrop-blur">
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/70">
                    Trust state
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                    {trust.title}
                  </h2>
                  <p className="mt-2 max-w-xs text-sm leading-6 text-white/76">
                    {trust.description}
                  </p>
                </aside>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <article className="rounded-[1.5rem] border border-border bg-surface px-5 py-6 sm:px-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
              About
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
              {isPerson ? "Public identity" : "Community home"}
            </h2>
            <div className="mt-4 space-y-4 text-sm leading-7 text-muted sm:text-base">
              {profile.bio ? <p>{profile.bio}</p> : null}
              {profile.about ? <p>{profile.about}</p> : null}
              {!profile.bio && !profile.about ? (
                <p>
                  Owner-authored bio and about sections are supported by the profile model and will appear here once populated.
                </p>
              ) : null}
            </div>
          </article>

          <aside className="rounded-[1.5rem] border border-border bg-surface px-5 py-6 sm:px-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
              Basics
            </p>
            <dl className="mt-5 space-y-4 text-sm">
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
          </aside>
        </section>

        <section className="rounded-[1.5rem] border border-border bg-surface px-5 py-6 sm:px-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
                {isPerson ? "Upcoming events" : "Hosted events"}
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
                {isPerson ? "Where this profile appears next" : "Upcoming community events"}
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-muted">
              {isPerson
                ? "Derived from confirmed person-event links on published event records."
                : "Published events linked to this community profile."}
            </p>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {(isPerson ? profile.upcomingEvents : profile.hostedEvents).length === 0 ? (
              <p className="text-sm leading-6 text-muted">No public upcoming events yet.</p>
            ) : (
              (isPerson ? profile.upcomingEvents : profile.hostedEvents).map((event) => (
                <EventPreviewCard event={event} key={`${event.slug ?? event.title}-${event.startAt}`} />
              ))
            )}
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-border bg-surface px-5 py-6 sm:px-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
                Creator links
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
                Stores, commissions, and external work
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-muted">
              Owner-authored or reviewed links only. VRDex does not verify sales, fulfillment, or creator endorsement.
            </p>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {profile.outboundLinks.length === 0 ? (
              <p className="text-sm leading-6 text-muted">No public creator/store links yet.</p>
            ) : (
              profile.outboundLinks.map((link) => {
                const href = safeHttpsUrl(link.url);

                if (!href) {
                  return null;
                }

                return (
                  <a
                    className="rounded-2xl border border-border bg-surface-strong px-4 py-3 text-sm transition hover:-translate-y-0.5"
                    href={href}
                    key={`${link.type}-${link.url}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span className="block font-medium">{link.label}</span>
                    <span className="mt-1 block text-xs text-muted">
                      {linkSourceLabel(link.source)} external link
                    </span>
                  </a>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-border bg-surface px-5 py-6 sm:px-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
                World credits
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
                Worlds linked to this profile
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-muted">
              Credits come from published world profiles with explicit person/community attribution.
            </p>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {profile.worldCredits.length === 0 ? (
              <p className="text-sm leading-6 text-muted">No public world credits yet.</p>
            ) : (
              profile.worldCredits.map((world) => (
                <Link
                  className="rounded-2xl border border-border bg-surface-strong px-4 py-4 text-sm transition hover:-translate-y-0.5"
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
                    <span className="mt-4 flex flex-wrap gap-2">
                      {world.tags.slice(0, 3).map((tag) => (
                        <span
                          className="rounded-full border border-border bg-white px-3 py-1 text-xs"
                          key={tag}
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-[1.5rem] border border-border bg-surface px-5 py-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
              {isPerson ? "Roles" : "Community focus"}
            </p>
            <div className="mt-4">
              <PillList items={typeItems} />
            </div>
          </article>

          <article className="rounded-[1.5rem] border border-border bg-surface px-5 py-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
              Tags
            </p>
            <div className="mt-4">
              <PillList items={profile.tags} />
            </div>
          </article>

          <article className="rounded-[1.5rem] border border-border bg-surface px-5 py-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
              Aliases
            </p>
            <div className="mt-4">
              <PillList items={profile.aliases} />
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
