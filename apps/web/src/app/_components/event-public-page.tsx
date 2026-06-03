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

type DiscordTimestampSet = {
  shortTime: string;
  longTime: string;
  shortDate: string;
  longDate: string;
  shortDateTime: string;
  longDateTime: string;
  relative: string;
};

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
  slotCount: number;
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
  slots: Array<{
    position: number;
    startAt: number;
    endAt?: number;
    displayLabel: string;
    roleLabel: string;
    discord: DiscordTimestampSet;
    performer?: {
      slug: string;
      displayName: string;
      trustLabel: ProfileTrustLabel;
    };
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

function formatEventTime(timestamp: number, timezone: string | undefined): string {
  const baseOptions: Intl.DateTimeFormatOptions = {
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

function formatSlotTimeRange(slot: PublicEvent["slots"][number], timezone: string | undefined): string {
  const start = formatEventTime(slot.startAt, timezone);

  if (slot.endAt === undefined) {
    return start;
  }

  return `${start} - ${formatEventTime(slot.endAt, timezone)}`;
}

const actionCardClassName =
  "group rounded-md border border-accent/35 bg-accent/10 px-4 py-3 text-sm transition hover:border-accent hover:bg-accent/15";
const actionCardLooseClassName =
  "group rounded-md border border-accent/35 bg-accent/10 px-4 py-4 text-sm transition hover:border-accent hover:bg-accent/15";
const actionLabelClassName =
  "block font-medium text-accent-strong underline decoration-accent/45 underline-offset-4 group-hover:decoration-accent";
const actionMetaClassName = "mt-1 block text-xs text-muted";
const inlineActionClassName =
  "font-semibold tracking-[-0.02em] text-accent-strong underline decoration-accent/45 underline-offset-4 hover:decoration-accent";

export function EventPreviewCard({ event }: { event: PublicEventPreview }) {
  const sourceUrl = safeHttpsUrl(event.source.url);
  const posterStyle = safeImageBackground(event.posterImageUrl, true);

  return (
    <article className="group overflow-hidden rounded-lg border border-border bg-surface-strong text-sm transition hover:-translate-y-0.5">
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
            <span className="rounded-md border border-border bg-white px-3 py-1">
              {event.participantCount} linked profile{event.participantCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {event.slotCount > 0 ? (
            <span className="rounded-md border border-border bg-white px-3 py-1">
              {event.slotCount} set time{event.slotCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {event.worlds.map((world) => (
            <span className="rounded-md border border-border bg-white px-3 py-1" key={world.slug}>
              {world.displayName}
            </span>
          ))}
          {sourceUrl ? (
            <a
              className="rounded-md border border-border bg-white px-3 py-1 font-medium"
              href={sourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              {event.source.label}
            </a>
          ) : (
            <span className="rounded-md border border-border bg-white px-3 py-1">
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
      <section className="mx-auto max-w-3xl rounded-lg border border-border bg-surface px-6 py-8 shadow-[0_24px_80px_rgba(64,40,24,0.12)] sm:px-8">
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
          className="mt-6 inline-flex rounded-md border border-border bg-surface-strong px-5 py-3 text-sm font-medium"
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
            <Link className="rounded-md border border-border bg-white/80 px-4 py-2 font-medium" href="/events/new">
              Add event
            </Link>
            {showEditLink ? (
              <Link className="rounded-md border border-border bg-white/80 px-4 py-2 font-medium" href={`/events/${event.slug}/edit`}>
                Edit event
              </Link>
            ) : null}
          </div>
        </nav>

        <section className="overflow-hidden rounded-lg border border-purple-950/10 bg-slate-950 shadow-[0_24px_90px_rgba(41,20,61,0.18)]">
          <div
            className="relative min-h-56 bg-[radial-gradient(circle_at_top_right,rgba(198,153,255,0.32),transparent_30%),linear-gradient(135deg,#17111f,#5d3b8e_52%,#20142f)] bg-cover bg-center p-5 text-white sm:p-6 lg:p-8"
            style={posterStyle}
          >
            <span className="absolute top-4 right-4 rounded-md bg-white/15 px-3 py-1 font-mono text-xs uppercase tracking-[0.22em] text-white/82">
              Event
            </span>
            <div className="flex min-h-44 flex-col justify-end pr-16">
              <div className="max-w-4xl">
                <time className="text-sm uppercase tracking-[0.24em] text-white/70" dateTime={new Date(event.startAt).toISOString()}>
                  {formatEventDate(event.startAt, event.timezone)}
                </time>
                <h1 className="mt-4 text-5xl leading-none font-semibold tracking-[-0.05em] sm:text-7xl">
                  {event.title}
                </h1>
                {event.summary ? <p className="mt-4 max-w-2xl text-base leading-7 text-white/82 sm:text-lg">{event.summary}</p> : null}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <aside className="rounded-lg border border-border bg-white/80 px-5 py-6 shadow-sm sm:px-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">When</p>
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
            </dl>
            <p className="mt-4 text-xs leading-5 text-muted">
              Time zone: {event.timezone ?? "not listed"}
            </p>
          </aside>

          <article className="rounded-lg border border-border bg-white/80 px-5 py-6 shadow-sm sm:px-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">Place</p>
            <div className="mt-5 grid gap-3 text-sm">
              {event.communitySlug ? (
                <Link className={actionCardClassName} href={`/c/${event.communitySlug}`}>
                  <span className={actionLabelClassName}>
                    {event.communityName ?? "Community profile"}
                  </span>
                  <span className={actionMetaClassName}>Host</span>
                </Link>
              ) : event.communityName ? (
                <div className="rounded-md border border-border bg-surface px-4 py-3 font-medium">
                  {event.communityName}
                </div>
              ) : (
                <p className="leading-6 text-muted">No host listed.</p>
              )}
              {event.worlds.map((world) => (
                <Link className={actionCardClassName} href={`/w/${world.slug}`} key={world.slug}>
                  <span className={actionLabelClassName}>
                    {world.displayName}
                  </span>
                  {world.summary ? <span className="mt-1 block text-muted">{world.summary}</span> : null}
                  <span className={actionMetaClassName}>World</span>
                </Link>
              ))}
            </div>
          </article>
        </section>

        <section className="rounded-lg border border-border bg-white/80 px-5 py-6 shadow-sm sm:px-6">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">Set times</p>
          <div className="mt-5">
            {event.slots.length === 0 ? (
              <p className="text-sm leading-6 text-muted">No set times yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border bg-surface">
                <div className="grid divide-y divide-border text-sm sm:hidden">
                  {event.slots.map((slot) => (
                    <div className="grid gap-2 px-4 py-3" key={`${slot.position}-${slot.startAt}-${slot.displayLabel}-mobile`}>
                      <time className="font-medium" dateTime={new Date(slot.startAt).toISOString()}>
                        {formatSlotTimeRange(slot, event.timezone)}
                      </time>
                      <div>
                        {slot.performer ? (
                          <Link className={inlineActionClassName} href={`/p/${slot.performer.slug}`}>
                            {slot.displayLabel}
                          </Link>
                        ) : (
                          <span className="font-semibold tracking-[-0.02em]">{slot.displayLabel}</span>
                        )}
                      </div>
                      <div className="text-muted">{slot.roleLabel}</div>
                    </div>
                  ))}
                </div>
                <table className="hidden w-full border-collapse text-left text-sm sm:table">
                  <thead className="border-b border-border bg-white/70 text-xs uppercase tracking-[0.18em] text-muted">
                    <tr>
                      <th className="px-4 py-3 font-medium">Time</th>
                      <th className="px-4 py-3 font-medium">Artist</th>
                      <th className="px-4 py-3 font-medium">Style(s)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {event.slots.map((slot) => (
                      <tr className="align-top" key={`${slot.position}-${slot.startAt}-${slot.displayLabel}`}>
                        <td className="whitespace-nowrap px-4 py-3 font-medium">{formatSlotTimeRange(slot, event.timezone)}</td>
                        <td className="px-4 py-3">
                          {slot.performer ? (
                            <Link className={inlineActionClassName} href={`/p/${slot.performer.slug}`}>
                              {slot.displayLabel}
                            </Link>
                          ) : (
                            <span className="font-semibold tracking-[-0.02em]">{slot.displayLabel}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted">{slot.roleLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-white/80 px-5 py-6 shadow-sm sm:px-6">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">Lineup</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {event.participants.length === 0 ? (
              <p className="text-sm leading-6 text-muted">No lineup yet.</p>
            ) : (
              event.participants.map((participant) => (
                <Link className={actionCardLooseClassName} href={`/p/${participant.slug}`} key={participant.slug}>
                  <span className="block text-lg font-semibold tracking-[-0.03em] text-accent-strong underline decoration-accent/45 underline-offset-4 group-hover:decoration-accent">
                    {participant.displayName}
                  </span>
                  <span className="mt-2 block text-muted">{participant.roleLabel}</span>
                  <span className={actionMetaClassName}>Profile</span>
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <article className="rounded-lg border border-border bg-white/80 px-5 py-6 shadow-sm">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">Links</p>
            <div className="mt-4 grid gap-3">
              {event.mediaLinks.length === 0 && !sourceUrl ? (
                <p className="text-sm leading-6 text-muted">No links yet.</p>
              ) : null}
              {sourceUrl ? (
                <a className={actionCardClassName} href={sourceUrl} rel="noreferrer" target="_blank">
                  <span className={actionLabelClassName}>
                    {event.source.label}
                  </span>
                  <span className={actionMetaClassName}>Source</span>
                </a>
              ) : null}
              {event.mediaLinks.map((link) => (
                <a className={actionCardClassName} href={link.url} key={`${link.type}-${link.url}`} rel="noreferrer" target="_blank">
                  <span className={actionLabelClassName}>
                    {link.label}
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    {mediaLinkTypeLabel(link.type)} / {link.presentation === "copy" ? "Copy link" : "Open"}
                  </span>
                </a>
              ))}
            </div>
          </article>

          <article className="rounded-lg border border-border bg-white/80 px-5 py-6 shadow-sm">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">Notes</p>
            <div className="mt-4 space-y-4 text-sm leading-7 text-muted">
              {event.notes ? <p>{event.notes}</p> : <p>No notes yet.</p>}
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
