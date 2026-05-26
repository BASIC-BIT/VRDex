import Link from "next/link";

type EventSourceType = "manual" | "community" | "partner" | "import" | "ai_suggested";
type EventMediaLinkType =
  | "event_page"
  | "watch"
  | "stream"
  | "vrcdn"
  | "discord"
  | "ticket"
  | "other";
type EventMediaLinkPresentation = "open" | "copy";
type ProfileTrustLabel =
  | "community_submitted"
  | "unclaimed"
  | "claimed_unverified"
  | "claimed_verified";

export type PublicEventPreview = {
  slug?: string;
  title: string;
  startAt: number;
  endAt?: number;
  timezone?: string;
  communityName?: string;
  communitySlug?: string;
  summary?: string;
  posterImageUrl?: string;
  source: {
    sourceType: EventSourceType;
    label: string;
    url?: string;
  };
  worlds: Array<{
    slug: string;
    displayName: string;
  }>;
  participantCount: number;
};

export type PublicEvent = Omit<PublicEventPreview, "worlds"> & {
  slug: string;
  notes?: string;
  mediaLinks: Array<{
    type: EventMediaLinkType;
    label: string;
    url: string;
    presentation: EventMediaLinkPresentation;
  }>;
  worlds: Array<{
    slug: string;
    displayName: string;
    tags: string[];
    summary?: string;
    heroImageUrl?: string;
    association: {
      sourceType: EventSourceType;
      confirmationState: "confirmed";
      confirmedAt?: number;
    };
  }>;
  participants: Array<{
    slug: string;
    displayName: string;
    roleLabel: string;
    trustLabel: ProfileTrustLabel;
    source: {
      sourceType: EventSourceType;
      label: string;
      url?: string;
    };
  }>;
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
        ? `linear-gradient(135deg, rgba(25, 17, 31, 0.72), rgba(105, 56, 169, 0.2)), ${image}`
        : image,
    };
  } catch {
    return undefined;
  }
}

function safeHttpsUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
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

function mediaLinkTypeLabel(type: EventMediaLinkType): string {
  if (type === "event_page") {
    return "Event page";
  }

  if (type === "vrcdn") {
    return "VRCDN";
  }

  return eventSourceLabel(type as EventSourceType);
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

function trustLabel(label: ProfileTrustLabel): string {
  if (label === "claimed_verified") {
    return "Verified owner";
  }

  if (label === "claimed_unverified") {
    return "Claimed";
  }

  if (label === "community_submitted") {
    return "Community submitted";
  }

  return "Unclaimed";
}

export function EventPreviewCard({ event }: { event: PublicEventPreview }) {
  const sourceUrl = safeHttpsUrl(event.source.url);
  const posterStyle = safeImageBackground(event.posterImageUrl, true);

  return (
    <article className="group overflow-hidden rounded-2xl border border-border bg-surface-strong text-sm transition hover:-translate-y-0.5">
      <div
        className="min-h-28 bg-[radial-gradient(circle_at_top_left,rgba(214,106,77,0.22),transparent_34%),linear-gradient(135deg,#2c1d29,#60429a)] bg-cover bg-center px-4 py-4 text-white"
        style={posterStyle}
      >
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/80">
          <time dateTime={new Date(event.startAt).toISOString()}>
            {formatEventDate(event.startAt, event.timezone)}
          </time>
          {event.communityName ? <span>/ {event.communityName}</span> : null}
        </div>
        <h3 className="mt-4 text-2xl font-semibold tracking-[-0.04em]">
          {event.slug ? <Link href={`/e/${event.slug}`}>{event.title}</Link> : event.title}
        </h3>
      </div>
      <div className="grid gap-3 px-4 py-4">
        {event.summary ? <p className="leading-6 text-muted">{event.summary}</p> : null}
        <div className="flex flex-wrap gap-2 text-xs">
          {event.participantCount > 0 ? (
            <span className="rounded-full border border-border bg-white px-3 py-1">
              {event.participantCount} linked profile{event.participantCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {event.worlds.map((world) => (
            <span className="rounded-full border border-border bg-white px-3 py-1" key={world.slug}>
              {world.displayName}
            </span>
          ))}
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
}

export function EventBackendNotice({ kind }: { kind: "missing-url" | "error" }) {
  return (
    <main className="min-h-screen px-6 py-10 text-foreground sm:px-10 lg:px-16">
      <section className="mx-auto max-w-3xl rounded-[2rem] border border-border bg-surface px-6 py-8 shadow-[0_24px_80px_rgba(64,40,24,0.12)] sm:px-8">
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">Event page</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">
          {kind === "missing-url" ? "Convex URL not configured" : "Event read failed"}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">
          {kind === "missing-url"
            ? "Run the local backend bootstrap before loading public event pages from this worktree."
            : "Start the local Convex backend and reload this page once the event query is reachable."}
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

export function EventPublicPage({ event, showEditLink = false }: { event: PublicEvent; showEditLink?: boolean }) {
  const posterStyle = safeImageBackground(event.posterImageUrl, true);
  const sourceUrl = safeHttpsUrl(event.source.url);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(125,74,202,0.14),transparent_32%),linear-gradient(180deg,#faf7fb,#f3efe8)] px-6 py-8 text-foreground sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <nav className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link className="font-mono uppercase tracking-[0.28em] text-muted" href="/">
            VRDex
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link className="rounded-full border border-border bg-white/80 px-4 py-2 font-medium" href="/events/new">
              Add event
            </Link>
            {showEditLink ? (
              <Link className="rounded-full border border-border bg-white/80 px-4 py-2 font-medium" href={`/events/${event.slug}/edit`}>
                Edit event
              </Link>
            ) : null}
          </div>
        </nav>

        <section className="overflow-hidden rounded-[2rem] border border-purple-950/10 bg-slate-950 shadow-[0_24px_90px_rgba(41,20,61,0.18)]">
          <div
            className="min-h-72 bg-[radial-gradient(circle_at_top_right,rgba(198,153,255,0.32),transparent_30%),linear-gradient(135deg,#17111f,#5d3b8e_52%,#20142f)] bg-cover bg-center p-6 text-white sm:p-8 lg:p-10"
            style={posterStyle}
          >
            <div className="flex min-h-60 flex-col justify-between gap-10">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-white/15 px-3 py-1 font-mono text-xs uppercase tracking-[0.22em] text-white/82">
                  Event
                </span>
                <span className="rounded-full bg-white/15 px-3 py-1 font-mono text-xs uppercase tracking-[0.22em] text-white/82">
                  /e/{event.slug}
                </span>
              </div>

              <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
                <div className="max-w-4xl">
                  <time className="text-sm uppercase tracking-[0.24em] text-white/70" dateTime={new Date(event.startAt).toISOString()}>
                    {formatEventDate(event.startAt, event.timezone)}
                  </time>
                  <h1 className="mt-4 text-5xl leading-none font-semibold tracking-[-0.05em] sm:text-7xl">
                    {event.title}
                  </h1>
                  <p className="mt-4 max-w-2xl text-base leading-7 text-white/82 sm:text-lg">
                    {event.summary ?? "A published VRDex event with source-aware community, world, and profile context."}
                  </p>
                </div>

                <aside className="rounded-[1.5rem] border border-white/20 bg-white/14 p-4 backdrop-blur">
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/70">Source</p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                    {eventSourceLabel(event.source.sourceType)}
                  </h2>
                  <p className="mt-2 max-w-xs text-sm leading-6 text-white/76">
                    {event.source.label}. Participant and world links are source-attributed and reviewable.
                  </p>
                </aside>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <article className="rounded-[1.5rem] border border-border bg-white/80 px-5 py-6 shadow-sm sm:px-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">Event context</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">Hosted by and happening at</h2>
            <div className="mt-5 grid gap-3 text-sm">
              {event.communitySlug ? (
                <Link className="rounded-2xl border border-border bg-surface px-4 py-3 font-medium" href={`/c/${event.communitySlug}`}>
                  {event.communityName ?? "Community profile"}
                </Link>
              ) : event.communityName ? (
                <div className="rounded-2xl border border-border bg-surface px-4 py-3 font-medium">
                  {event.communityName}
                </div>
              ) : (
                <p className="leading-6 text-muted">No public host community is linked yet.</p>
              )}
              {event.worlds.map((world) => (
                <Link className="rounded-2xl border border-border bg-surface px-4 py-3" href={`/w/${world.slug}`} key={world.slug}>
                  <span className="block font-medium">{world.displayName}</span>
                  {world.summary ? <span className="mt-1 block text-muted">{world.summary}</span> : null}
                </Link>
              ))}
            </div>
          </article>

          <aside className="rounded-[1.5rem] border border-border bg-white/80 px-5 py-6 shadow-sm sm:px-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">Public details</p>
            <dl className="mt-5 space-y-4 text-sm">
              <div className="border-b border-border pb-4">
                <dt className="text-muted">Start</dt>
                <dd className="mt-1 font-medium">{formatEventDate(event.startAt, event.timezone)}</dd>
              </div>
              <div className="border-b border-border pb-4">
                <dt className="text-muted">End</dt>
                <dd className="mt-1 font-medium">
                  {event.endAt ? formatEventDate(event.endAt, event.timezone) : "Not listed"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Time zone</dt>
                <dd className="mt-1 font-medium">{event.timezone ?? "Not listed"}</dd>
              </div>
            </dl>
          </aside>
        </section>

        <section className="rounded-[1.5rem] border border-border bg-white/80 px-5 py-6 shadow-sm sm:px-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">Linked profiles</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">People associated with this event</h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-muted">
              These links can point at claimed or unclaimed published profiles. Approval and dispute workflows are tracked separately.
            </p>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {event.participants.length === 0 ? (
              <p className="text-sm leading-6 text-muted">No public participant links yet.</p>
            ) : (
              event.participants.map((participant) => (
                <Link className="rounded-2xl border border-border bg-surface px-4 py-4 text-sm" href={`/p/${participant.slug}`} key={participant.slug}>
                  <span className="block text-lg font-semibold tracking-[-0.03em]">{participant.displayName}</span>
                  <span className="mt-2 block text-muted">{participant.roleLabel}</span>
                  <span className="mt-3 inline-flex rounded-full border border-border bg-white px-3 py-1 text-xs">
                    {trustLabel(participant.trustLabel)}
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <article className="rounded-[1.5rem] border border-border bg-white/80 px-5 py-6 shadow-sm">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">Media and links</p>
            <div className="mt-4 grid gap-3">
              {event.mediaLinks.length === 0 && !sourceUrl ? (
                <p className="text-sm leading-6 text-muted">No public event media links yet.</p>
              ) : null}
              {sourceUrl ? (
                <a className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm font-medium" href={sourceUrl} rel="noreferrer" target="_blank">
                  {event.source.label}
                </a>
              ) : null}
              {event.mediaLinks.map((link) => (
                <a className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm" href={link.url} key={`${link.type}-${link.url}`} rel="noreferrer" target="_blank">
                  <span className="block font-medium">{link.label}</span>
                  <span className="mt-1 block text-xs text-muted">
                    {mediaLinkTypeLabel(link.type)} {link.presentation === "copy" ? "copyable link" : "external link"}
                  </span>
                </a>
              ))}
            </div>
          </article>

          <article className="rounded-[1.5rem] border border-border bg-white/80 px-5 py-6 shadow-sm">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">Notes</p>
            <div className="mt-4 space-y-4 text-sm leading-7 text-muted">
              {event.notes ? <p>{event.notes}</p> : <p>No public event notes yet.</p>}
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
