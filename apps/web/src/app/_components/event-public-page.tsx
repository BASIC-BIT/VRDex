import Link from "next/link";

import {
  actionCardVariants,
  actionLabelClassName,
  actionMetaClassName,
  inlineActionClassName,
} from "@/components/ui/action-card";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { Table, TableCell, TableFrame, TableHead, TableHeaderCell } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { safeImageBackground } from "@/lib/safe-image";
import { EventWatchSurface } from "./event-watch-surface";
import {
  ViewerLocalEventDateTime,
  ViewerLocalEventTime,
  ViewerLocalEventTimeRange,
} from "./viewer-local-event-times";

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
  doorsOpenAt?: number;
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

const eventPosterOverlay = "linear-gradient(135deg, rgba(25, 17, 31, 0.72), rgba(105, 56, 169, 0.2))";

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

function EventTimeDefinition({ label, timestamp }: { label: string; timestamp: number }) {
  return (
    <div className="grid gap-1 border-b border-border pb-4 sm:grid-cols-[7rem_1fr] sm:gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">
        <ViewerLocalEventDateTime timestamp={timestamp} />
      </dd>
    </div>
  );
}

export function EventPreviewCard({ event }: { event: PublicEventPreview }) {
  const sourceUrl = safeHttpsUrl(event.source.url);
  const posterStyle = safeImageBackground(event.posterImageUrl, eventPosterOverlay);
  const details = event.worlds.map((world) => world.displayName);

  return (
    <article className="group overflow-hidden rounded-card border border-border bg-surface-strong text-sm transition hover:-translate-y-0.5">
      <div
        className="min-h-28 bg-[radial-gradient(circle_at_top_left,rgba(214,106,77,0.22),transparent_34%),linear-gradient(135deg,#2c1d29,#60429a)] bg-cover bg-center px-4 py-4 text-white"
        style={posterStyle}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-white/84">
          <ViewerLocalEventDateTime timestamp={event.startAt} />
          {event.doorsOpenAt === undefined ? null : <span>Doors <ViewerLocalEventTime timestamp={event.doorsOpenAt} /></span>}
          {event.communityName ? <span>/ {event.communityName}</span> : null}
        </div>
        <h3 className="mt-4 text-2xl font-semibold tracking-[-0.04em]">
          {event.slug ? <Link href={`/e/${event.slug}`}>{event.title}</Link> : event.title}
        </h3>
      </div>
      <div className="grid gap-3 px-4 py-4">
        {event.summary ? <p className="leading-6 text-muted">{event.summary}</p> : null}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {details.map((detail) => (
            <span key={detail}>{detail}</span>
          ))}
          {sourceUrl ? (
            <a
              className="font-medium text-accent-strong underline decoration-accent/35 underline-offset-4"
              href={sourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              {event.source.label}
            </a>
          ) : (
            <span>{event.source.label}</span>
          )}
        </div>
      </div>
    </article>
  );
}

export function EventBackendNotice({ kind }: { kind: "missing-url" | "error" }) {
  return (
    <PageShell className="py-10">
      <PageContainer max="3xl">
      <Card className="shadow-panel" padding="lg">
        <Eyebrow>Event page</Eyebrow>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">
          {kind === "missing-url" ? "Convex URL not configured" : "Event read failed"}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">
          {kind === "missing-url"
            ? "Run the local backend bootstrap before loading public event pages from this worktree."
            : "Start the local Convex backend and reload this page once the event query is reachable."}
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

export function EventPublicPage({ event, showEditLink = false }: { event: PublicEvent; showEditLink?: boolean }) {
  const posterStyle = safeImageBackground(event.posterImageUrl, eventPosterOverlay);
  const sourceUrl = safeHttpsUrl(event.source.url);

  return (
    <PageShell className="py-5 sm:py-6 lg:py-7" tone="event">
      <PageContainer className="gap-5">
        <PageNav>
          <BrandLink />
          <div className="flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: "surface" })} href="/events/new">
              Add event
            </Link>
            {showEditLink ? (
              <Link className={buttonVariants({ variant: "surface" })} href={`/events/${event.slug}/edit`}>
                Edit event
              </Link>
            ) : null}
          </div>
        </PageNav>

        <section className="overflow-hidden rounded-hero border border-purple-950/10 bg-slate-950 shadow-hero">
          <div
            className="relative min-h-56 bg-[radial-gradient(circle_at_top_right,rgba(198,153,255,0.32),transparent_30%),linear-gradient(135deg,#17111f,#5d3b8e_52%,#20142f)] bg-cover bg-center p-5 text-white sm:p-6 lg:p-8"
            style={posterStyle}
          >
            <div className="flex min-h-44 flex-col justify-end">
              <div className="max-w-4xl">
                <ViewerLocalEventDateTime className="text-sm uppercase tracking-[0.24em] text-white/70" timestamp={event.startAt} />
                <h1 className="mt-4 text-5xl leading-none font-semibold tracking-[-0.05em] sm:text-7xl">
                  {event.title}
                </h1>
                {event.summary ? <p className="mt-4 max-w-2xl text-base leading-7 text-white/82 sm:text-lg">{event.summary}</p> : null}
              </div>
            </div>
          </div>
        </section>

        <EventWatchSurface
          doorsOpenAt={event.doorsOpenAt}
          endAt={event.endAt}
          mediaLinks={event.mediaLinks}
          startAt={event.startAt}
        />

        <section className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <Card surface="white">
            <Eyebrow>When</Eyebrow>
            <dl className="mt-5 space-y-4 text-sm">
              {event.doorsOpenAt === undefined ? null : <EventTimeDefinition label="Doors open" timestamp={event.doorsOpenAt} />}
              <EventTimeDefinition label="Start" timestamp={event.startAt} />
              <div className="grid gap-1 border-b border-border pb-4 sm:grid-cols-[7rem_1fr] sm:gap-4">
                <dt className="text-muted">End</dt>
                <dd className="font-medium">
                  {event.endAt ? <ViewerLocalEventDateTime timestamp={event.endAt} /> : "Not listed"}
                </dd>
              </div>
            </dl>
          </Card>

          <Card surface="white">
            <Eyebrow>Place</Eyebrow>
            <div className="mt-5 grid gap-3 text-sm">
              {event.communitySlug ? (
                <Link className={actionCardVariants({ variant: "accent" })} href={`/c/${event.communitySlug}`}>
                  <span className={actionLabelClassName}>
                    {event.communityName ?? "Community profile"}
                  </span>
                  <span className={actionMetaClassName}>Host</span>
                </Link>
              ) : event.communityName ? (
                <div className="rounded-control border border-border bg-surface px-4 py-3 font-medium">
                  {event.communityName}
                </div>
              ) : (
                <p className="leading-6 text-muted">No host listed.</p>
              )}
              {event.worlds.map((world) => (
                <Link className={actionCardVariants({ variant: "accent" })} href={`/w/${world.slug}`} key={world.slug}>
                  <span className={actionLabelClassName}>
                    {world.displayName}
                  </span>
                  {world.summary ? <span className="mt-1 block text-muted">{world.summary}</span> : null}
                  <span className={actionMetaClassName}>World</span>
                </Link>
              ))}
            </div>
          </Card>
        </section>

        <Card surface="white">
          <Eyebrow>Set times</Eyebrow>
          <div className="mt-5">
            {event.slots.length === 0 ? (
              <p className="text-sm leading-6 text-muted">No set times yet.</p>
            ) : (
              <TableFrame>
                <div className="grid divide-y divide-border text-sm sm:hidden">
                  {event.slots.map((slot) => (
                    <div className="grid gap-2 px-4 py-3" key={`${slot.position}-${slot.startAt}-${slot.displayLabel}-mobile`}>
                      <ViewerLocalEventTimeRange className="font-medium" endAt={slot.endAt} startAt={slot.startAt} />
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
                <Table className="hidden sm:table">
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Time</TableHeaderCell>
                      <TableHeaderCell>Artist</TableHeaderCell>
                      <TableHeaderCell>Style(s)</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <tbody className="divide-y divide-border">
                    {event.slots.map((slot) => (
                      <tr className="align-top" key={`${slot.position}-${slot.startAt}-${slot.displayLabel}`}>
                        <TableCell className="whitespace-nowrap font-medium"><ViewerLocalEventTimeRange endAt={slot.endAt} startAt={slot.startAt} /></TableCell>
                        <TableCell>
                          {slot.performer ? (
                            <Link className={inlineActionClassName} href={`/p/${slot.performer.slug}`}>
                              {slot.displayLabel}
                            </Link>
                          ) : (
                            <span className="font-semibold tracking-[-0.02em]">{slot.displayLabel}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted">{slot.roleLabel}</TableCell>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableFrame>
            )}
          </div>
        </Card>

        <Card surface="white">
          <Eyebrow>Lineup</Eyebrow>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {event.participants.length === 0 ? (
              <p className="text-sm leading-6 text-muted">No lineup yet.</p>
            ) : (
              event.participants.map((participant) => (
                <Link className={actionCardVariants({ padding: "lg", variant: "accent" })} href={`/p/${participant.slug}`} key={participant.slug}>
                  <span className="block text-lg font-semibold tracking-[-0.03em] text-accent-strong underline decoration-accent/45 underline-offset-4 group-hover:decoration-accent">
                    {participant.displayName}
                  </span>
                  <span className="mt-2 block text-muted">{participant.roleLabel}</span>
                  <span className={actionMetaClassName}>Profile</span>
                </Link>
              ))
            )}
          </div>
        </Card>

        <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Card surface="white">
            <Eyebrow>Links</Eyebrow>
            <div className="mt-4 grid gap-3">
              {event.mediaLinks.length === 0 && !sourceUrl ? (
                <p className="text-sm leading-6 text-muted">No links yet.</p>
              ) : null}
              {sourceUrl ? (
                <a className={actionCardVariants({ variant: "accent" })} href={sourceUrl} rel="noreferrer" target="_blank">
                  <span className={actionLabelClassName}>
                    {event.source.label}
                  </span>
                  <span className={actionMetaClassName}>Reference link</span>
                </a>
              ) : null}
              {event.mediaLinks.map((link) => (
                <a className={actionCardVariants({ variant: "accent" })} href={link.url} key={`${link.type}-${link.url}`} rel="noreferrer" target="_blank">
                  <span className={actionLabelClassName}>
                    {link.label}
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    {link.presentation === "copy" ? "Copy link" : "Open link"}
                  </span>
                </a>
              ))}
            </div>
          </Card>

          <Card surface="white">
            <Eyebrow>Notes</Eyebrow>
            <div className="mt-4 space-y-4 text-sm leading-7 text-muted">
              {event.notes ? <p>{event.notes}</p> : <p>No notes yet.</p>}
            </div>
          </Card>
        </section>
      </PageContainer>
    </PageShell>
  );
}
