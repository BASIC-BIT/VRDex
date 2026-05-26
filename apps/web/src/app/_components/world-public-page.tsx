import Link from "next/link";

type WorldVisibilityStatus = "unknown" | "private" | "community_labs" | "public";
type PlatformCompatibility = "pc" | "android" | "ios";
type WorldCreatorRole =
  | "world_author"
  | "builder"
  | "venue_operator"
  | "community_operator"
  | "media_credit"
  | "storefront_owner";
type WorldLinkType =
  | "vrchat_world"
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
type WorldLinkSource = "owner_authored" | "reviewed" | "partner_provided";
type EventSourceType = "manual" | "community" | "partner" | "import" | "ai_suggested";

type PublicWorldEventPreview = {
  slug?: string;
  title: string;
  startAt: number;
  endAt?: number;
  timezone?: string;
  communityName?: string;
  summary?: string;
  posterImageUrl?: string;
  mediaLinks: Array<{
    type: "event_page" | "watch" | "stream" | "vrcdn" | "discord" | "ticket" | "other";
    label: string;
    url: string;
    presentation: "open" | "copy";
  }>;
  source: {
    sourceType: EventSourceType;
    label: string;
    url?: string;
  };
  worldAssociation: {
    sourceType: EventSourceType;
    confirmationState: "confirmed";
    confirmedAt?: number;
  };
};

export type PublicWorld = {
  slug: string;
  displayName: string;
  tags: string[];
  summary?: string;
  description?: string;
  vrchatWorldId?: string;
  canonicalVrchatWorldUrl?: string;
  sourceUrl?: string;
  visibilityStatus: WorldVisibilityStatus;
  platformCompatibility: PlatformCompatibility[];
  heroImageUrl?: string;
  media: Array<{
    kind: "image" | "video" | "link";
    url: string;
    label?: string;
    credit?: string;
  }>;
  creatorAttributions: Array<{
    role: WorldCreatorRole;
    displayName: string;
    profileSlug?: string;
    profileType?: "person" | "community";
    sourceLabel?: string;
  }>;
  outboundLinks: Array<{
    type: WorldLinkType;
    label: string;
    url: string;
    source: WorldLinkSource;
  }>;
  source?: {
    sourceType: "owner" | "community" | "partner" | "moderator" | "import";
    label: string;
    url?: string;
    confirmedAt?: number;
  };
  eventContext: {
    upcoming: PublicWorldEventPreview[];
    recent: PublicWorldEventPreview[];
  };
};

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
        ? `linear-gradient(135deg, rgba(11, 18, 32, 0.72), rgba(18, 95, 118, 0.22)), ${image}`
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

function visibilityLabel(status: WorldVisibilityStatus): string {
  if (status === "community_labs") {
    return "Community Labs";
  }

  if (status === "public") {
    return "Public";
  }

  if (status === "private") {
    return "Private";
  }

  return "Unknown";
}

function platformLabel(platform: PlatformCompatibility): string {
  if (platform === "pc") {
    return "PC";
  }

  if (platform === "android") {
    return "Android / Quest";
  }

  return "iOS";
}

function roleLabel(role: WorldCreatorRole): string {
  return role
    .split("_")
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

function linkSourceLabel(source: WorldLinkSource): string {
  if (source === "owner_authored") {
    return "Owner-authored";
  }

  if (source === "partner_provided") {
    return "Partner-provided";
  }

  return "Reviewed";
}

function eventSourceLabel(source: EventSourceType): string {
  if (source === "ai_suggested") {
    return "AI-suggested";
  }

  return source
    .split("_")
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

function formatEventDate(timestamp: number, timezone: string | undefined): string {
  const baseOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };

  try {
    return new Intl.DateTimeFormat("en", {
      ...baseOptions,
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(new Date(timestamp));
  } catch {
    return new Intl.DateTimeFormat("en", baseOptions).format(new Date(timestamp));
  }
}

function initialsFor(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "W";
}

function PillList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-sm leading-6 text-muted">No public entries yet.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          className="rounded-full border border-cyan-900/15 bg-cyan-50 px-3 py-1 text-sm text-cyan-950"
          key={item}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function EventList({
  emptyLabel,
  events,
}: {
  emptyLabel: string;
  events: PublicWorldEventPreview[];
}) {
  if (events.length === 0) {
    return <p className="text-sm leading-6 text-muted">{emptyLabel}</p>;
  }

  return (
    <div className="grid gap-3">
      {events.map((event) => {
        const sourceUrl = event.source.url ? safeHttpsUrl(event.source.url) : null;
        const posterStyle = safeImageBackground(event.posterImageUrl, true);
        const posterTextClass = posterStyle ? "text-white/76" : "text-muted";

        return (
          <article
            className="overflow-hidden rounded-2xl border border-cyan-950/10 bg-surface text-sm"
            key={`${event.title}-${event.startAt}`}
          >
            <div
              className="bg-[radial-gradient(circle_at_top_left,rgba(9,189,214,0.18),transparent_36%),linear-gradient(135deg,#ecfeff,#ffffff)] bg-cover bg-center px-4 py-4"
              style={posterStyle}
            >
              <div className={`flex flex-wrap items-center gap-2 text-xs ${posterTextClass}`}>
                <time dateTime={new Date(event.startAt).toISOString()}>
                  {formatEventDate(event.startAt, event.timezone)}
                </time>
                <span aria-hidden="true">/</span>
                <span>Confirmed venue</span>
              </div>
              <h3 className={`mt-3 text-lg font-semibold tracking-[-0.03em] ${posterStyle ? "text-white" : ""}`}>
                {event.slug ? <Link href={`/e/${event.slug}`}>{event.title}</Link> : event.title}
              </h3>
              {event.communityName ? <p className={`mt-1 ${posterTextClass}`}>Hosted by {event.communityName}</p> : null}
            </div>
            <div className="px-4 py-4">
              {event.summary ? <p className="leading-6 text-muted">{event.summary}</p> : null}
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-cyan-50 px-3 py-1 text-cyan-950">
                  {eventSourceLabel(event.worldAssociation.sourceType)} association
                </span>
                {event.mediaLinks.length > 0 ? (
                  <span className="rounded-full border border-border bg-white px-3 py-1">
                    {event.mediaLinks.length} media link{event.mediaLinks.length === 1 ? "" : "s"}
                  </span>
                ) : null}
                {sourceUrl ? (
                  <a
                    className="rounded-full border border-border bg-white px-3 py-1 font-medium"
                    href={sourceUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {event.source.label}
                  </a>
                ) : (
                  <span className="rounded-full border border-border bg-white px-3 py-1">
                    {event.source.label}
                  </span>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function WorldBackendNotice({ kind }: { kind: "missing-url" | "error" }) {
  return (
    <main className="min-h-screen px-6 py-10 text-foreground sm:px-10 lg:px-16">
      <section className="mx-auto max-w-3xl rounded-[2rem] border border-border bg-surface px-6 py-8 shadow-[0_24px_80px_rgba(64,40,24,0.12)] sm:px-8">
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">World page</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">
          {kind === "missing-url" ? "Convex URL not configured" : "World read failed"}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">
          {kind === "missing-url"
            ? "Run the local backend bootstrap before loading public world pages from this worktree."
            : "Start the local Convex backend and reload this page once the world query is reachable."}
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

export function WorldPublicPage({ world }: { world: PublicWorld }) {
  const heroStyle = safeImageBackground(world.heroImageUrl, true);
  const canonicalWorldUrl = world.canonicalVrchatWorldUrl
    ? safeHttpsUrl(world.canonicalVrchatWorldUrl)
    : null;
  const sourceUrl = world.sourceUrl ? safeHttpsUrl(world.sourceUrl) : null;
  const sourceTitle = world.source?.label ?? "Unverified metadata";
  const sourceDescription = world.source
    ? "World metadata is source-attributed. Creator credits and commerce links should remain reviewable."
    : "World metadata is source-attributed when available.";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(9,189,214,0.14),transparent_32%),linear-gradient(180deg,#f7fbfb,#f3efe8)] px-6 py-8 text-foreground sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <nav className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link className="font-mono uppercase tracking-[0.28em] text-muted" href="/">
            VRDex
          </Link>
          <Link className="rounded-full border border-border bg-white/80 px-4 py-2 font-medium" href="/submit">
            Add a missing profile
          </Link>
        </nav>

        <section className="overflow-hidden rounded-[2rem] border border-cyan-950/10 bg-slate-950 shadow-[0_24px_90px_rgba(8,37,53,0.18)]">
          <div
            className="min-h-72 bg-[radial-gradient(circle_at_top_right,rgba(53,216,230,0.32),transparent_30%),linear-gradient(135deg,#09111f,#155e75_52%,#0f172a)] bg-cover bg-center p-6 text-white sm:p-8 lg:p-10"
            style={heroStyle}
          >
            <div className="flex min-h-60 flex-col justify-between gap-10">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-white/15 px-3 py-1 font-mono text-xs uppercase tracking-[0.22em] text-white/82">
                  World profile
                </span>
                <span className="rounded-full bg-white/15 px-3 py-1 font-mono text-xs uppercase tracking-[0.22em] text-white/82">
                  /w/{world.slug}
                </span>
              </div>

              <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
                <div className="flex flex-col gap-4">
                  <div className="flex size-24 items-center justify-center rounded-[1.75rem] border border-white/30 bg-white/15 text-3xl font-semibold shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
                    {initialsFor(world.displayName)}
                  </div>

                  <div className="max-w-3xl">
                    <h1 className="text-5xl leading-none font-semibold tracking-[-0.05em] sm:text-7xl">
                      {world.displayName}
                    </h1>
                    <p className="mt-4 max-w-2xl text-base leading-7 text-white/82 sm:text-lg">
                      {world.summary ?? "A public VRDex page for a VRChat world or venue."}
                    </p>
                  </div>
                </div>

                <aside className="rounded-[1.5rem] border border-white/20 bg-white/14 p-4 backdrop-blur">
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/70">
                    Source
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                    {sourceTitle}
                  </h2>
                  <p className="mt-2 max-w-xs text-sm leading-6 text-white/76">
                    {sourceDescription}
                  </p>
                </aside>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <article className="rounded-[1.5rem] border border-border bg-white/80 px-5 py-6 shadow-sm sm:px-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">About this world</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">Place, vibe, context</h2>
            <div className="mt-4 space-y-4 text-sm leading-7 text-muted sm:text-base">
              {world.description ? (
                <p>{world.description}</p>
              ) : (
                <p>
                  Owner-authored world descriptions are supported by the world model and will appear here once populated.
                </p>
              )}
            </div>
          </article>

          <aside className="rounded-[1.5rem] border border-border bg-white/80 px-5 py-6 shadow-sm sm:px-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">World details</p>
            <dl className="mt-5 space-y-4 text-sm">
              <div className="border-b border-border pb-4">
                <dt className="text-muted">VRChat world id</dt>
                <dd className="mt-1 font-medium">{world.vrchatWorldId ?? "Not listed"}</dd>
              </div>
              <div className="border-b border-border pb-4">
                <dt className="text-muted">Visibility</dt>
                <dd className="mt-1 font-medium">{visibilityLabel(world.visibilityStatus)}</dd>
              </div>
              <div>
                <dt className="text-muted">Platform hints</dt>
                <dd className="mt-2">
                  <PillList items={world.platformCompatibility.map(platformLabel)} />
                </dd>
              </div>
            </dl>
          </aside>
        </section>

        <section className="rounded-[1.5rem] border border-border bg-white/80 px-5 py-6 shadow-sm sm:px-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
                Events at this world
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
                Confirmed event context
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-muted">
              These previews come from explicit event-world links, not live VRChat presence or scraped popularity.
            </p>
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <article>
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">
                Upcoming and active
              </h3>
              <div className="mt-4">
                <EventList
                  emptyLabel="No confirmed upcoming events are linked to this world yet."
                  events={world.eventContext.upcoming}
                />
              </div>
            </article>
            <article>
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">Recent</h3>
              <div className="mt-4">
                <EventList
                  emptyLabel="No confirmed recent events are linked to this world yet."
                  events={world.eventContext.recent}
                />
              </div>
            </article>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-[1.5rem] border border-border bg-white/80 px-5 py-6 shadow-sm">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">Tags</p>
            <div className="mt-4">
              <PillList items={world.tags} />
            </div>
          </article>

          <article className="rounded-[1.5rem] border border-border bg-white/80 px-5 py-6 shadow-sm lg:col-span-2">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">Creator attribution</p>
            <div className="mt-4 space-y-3">
              {world.creatorAttributions.length === 0 ? (
                <p className="text-sm leading-6 text-muted">No public creator credits yet.</p>
              ) : (
                world.creatorAttributions.map((attribution) => {
                  const href = attribution.profileSlug && attribution.profileType
                    ? `/${attribution.profileType === "community" ? "c" : "p"}/${attribution.profileSlug}`
                    : null;
                  const content = (
                    <>
                      <span className="font-medium">{attribution.displayName}</span>
                      <span className="text-muted">{roleLabel(attribution.role)}</span>
                    </>
                  );

                  return href ? (
                    <Link
                      className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface px-4 py-3 text-sm"
                      href={href}
                      key={`${attribution.role}-${attribution.displayName}`}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div
                      className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface px-4 py-3 text-sm"
                      key={`${attribution.role}-${attribution.displayName}`}
                    >
                      {content}
                    </div>
                  );
                })
              )}
            </div>
          </article>
        </section>

        <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <article className="rounded-[1.5rem] border border-border bg-white/80 px-5 py-6 shadow-sm">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">Primary links</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {canonicalWorldUrl ? (
                <a
                  className="rounded-full border border-cyan-900/20 bg-cyan-950 px-4 py-2 text-sm font-medium text-white"
                  href={canonicalWorldUrl}
                  rel="noreferrer"
                  style={{ color: "#fff" }}
                  target="_blank"
                >
                  Open VRChat world
                </a>
              ) : null}
              {sourceUrl ? (
                <a
                  className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium"
                  href={sourceUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Source link
                </a>
              ) : null}
              {!canonicalWorldUrl && !sourceUrl ? (
                <p className="text-sm leading-6 text-muted">No public world links yet.</p>
              ) : null}
            </div>
          </article>

          <article className="rounded-[1.5rem] border border-border bg-white/80 px-5 py-6 shadow-sm">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">Creator links</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {world.outboundLinks.length === 0 ? (
                <p className="text-sm leading-6 text-muted">No public creator/store links yet.</p>
              ) : (
                world.outboundLinks.map((link) => {
                  const href = safeHttpsUrl(link.url);
                  if (!href) {
                    return null;
                  }

                  return (
                    <a
                      className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm"
                      href={href}
                      key={`${link.type}-${link.url}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <span className="block font-medium">{link.label}</span>
                      <span className="mt-1 block text-xs text-muted">{linkSourceLabel(link.source)}</span>
                    </a>
                  );
                })
              )}
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
