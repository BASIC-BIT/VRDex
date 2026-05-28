import Link from "next/link";

import { DiscoverySearchForm, TrackedDiscoveryLink } from "./discovery-analytics";

type EntityType = "profile" | "world" | "event";
type ProfileType = "person" | "community";

export type PublicSearchResult = {
  entityType: EntityType;
  profileType?: ProfileType;
  slug: string;
  routePath: string;
  title: string;
  subtitle?: string;
  summary?: string;
  imageUrl?: string;
  startsAt?: number;
  source?: {
    sourceType?: string;
    label: string;
  };
  score: number;
};

export type PublicDiscoveryData = {
  featured: PublicSearchResult[];
  upcomingEvents: PublicSearchResult[];
  people: PublicSearchResult[];
  communities: PublicSearchResult[];
  worlds: PublicSearchResult[];
  terms: Array<{
    scope: string;
    key: string;
    label: string;
    usageCount: number;
  }>;
};

type DiscoveryStatus = "live" | "missing-url" | "error";

function entityLabel(result: PublicSearchResult): string {
  if (result.entityType === "profile") {
    return result.profileType === "community" ? "Community" : "Person";
  }

  return result.entityType === "event" ? "Event" : "World";
}

function formatEventTime(value: number | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "VR";
}

function resultImageStyle(imageUrl: string | undefined) {
  if (!imageUrl) {
    return undefined;
  }

  try {
    const url = new URL(imageUrl);
    if (url.protocol !== "https:") {
      return undefined;
    }

    return { backgroundImage: `url(${JSON.stringify(url.href)})` };
  } catch {
    return undefined;
  }
}

function DiscoveryCard({ result, surface }: { result: PublicSearchResult; surface: string }) {
  const imageStyle = resultImageStyle(result.imageUrl);
  const time = formatEventTime(result.startsAt);

  return (
    <TrackedDiscoveryLink
      className="group grid gap-4 rounded-[1.5rem] border border-border bg-surface px-4 py-4 transition hover:-translate-y-1 hover:shadow-[0_18px_60px_rgba(64,40,24,0.12)] sm:grid-cols-[8rem_1fr]"
      eventName={result.entityType === "event" ? "event_card_clicked" : "search_result_clicked"}
      href={result.routePath}
      properties={{
        entity_type: result.entityType,
        profile_type: result.profileType,
        result_slug: result.slug,
        surface,
      }}
    >
      <span
        className="flex aspect-[4/3] items-center justify-center rounded-[1.15rem] bg-[linear-gradient(135deg,#2f211b,#d66a4d)] bg-cover bg-center text-2xl font-semibold text-white"
        style={imageStyle}
      >
        {!imageStyle ? initialsFor(result.title) : null}
      </span>
      <span className="flex min-w-0 flex-col gap-3">
        <span className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border bg-surface-strong px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.2em] text-muted">
            {entityLabel(result)}
          </span>
          {time ? (
            <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent-strong">
              {time}
            </span>
          ) : null}
        </span>
        <span className="text-xl font-semibold tracking-[-0.03em] group-hover:text-accent-strong">
          {result.title}
        </span>
        {result.subtitle ? <span className="text-sm text-muted">{result.subtitle}</span> : null}
        {result.summary ? (
          <span className="line-clamp-2 text-sm leading-6 text-muted">{result.summary}</span>
        ) : null}
        {result.source ? (
          <span className="text-xs text-muted">Source: {result.source.label}</span>
        ) : null}
      </span>
    </TrackedDiscoveryLink>
  );
}

function PosterCard({ result }: { result: PublicSearchResult }) {
  const imageStyle = resultImageStyle(result.imageUrl);

  return (
    <TrackedDiscoveryLink
      className="group min-h-80 overflow-hidden rounded-[1.6rem] border border-white/15 bg-[#241814] text-white shadow-[0_24px_80px_rgba(20,12,8,0.18)]"
      eventName="featured_card_clicked"
      href={result.routePath}
      properties={{ entity_type: result.entityType, result_slug: result.slug, surface: "featured" }}
    >
      <span
        className="flex min-h-80 flex-col justify-end bg-[radial-gradient(circle_at_top_left,rgba(214,106,77,0.45),transparent_34%),linear-gradient(145deg,#221512,#74311f)] bg-cover bg-center p-5"
        style={imageStyle}
      >
        <span className="rounded-full bg-white/16 px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.22em] text-white/78">
          Featured {entityLabel(result)}
        </span>
        <span className="mt-4 block text-3xl font-semibold tracking-[-0.04em]">
          {result.title}
        </span>
        {result.summary ? (
          <span className="mt-3 line-clamp-3 block text-sm leading-6 text-white/76">
            {result.summary}
          </span>
        ) : null}
      </span>
    </TrackedDiscoveryLink>
  );
}

function Section({
  title,
  eyebrow,
  empty,
  results,
}: {
  title: string;
  eyebrow: string;
  empty: string;
  results: PublicSearchResult[];
}) {
  return (
    <section className="rounded-[1.8rem] border border-border bg-white/34 px-5 py-6 backdrop-blur sm:px-6">
      <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{title}</h2>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {results.length === 0 ? (
          <p className="text-sm leading-6 text-muted">{empty}</p>
        ) : (
          results.map((result) => (
            <DiscoveryCard key={`${result.entityType}-${result.slug}`} result={result} surface={eyebrow} />
          ))
        )}
      </div>
    </section>
  );
}

export function DiscoveryBackendNotice({ kind }: { kind: "missing-url" | "error" }) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-white/25 bg-white/14 px-5 py-4 text-sm leading-6 text-white/78">
      {kind === "missing-url"
        ? "Convex is not configured, so this page is showing fixture discovery content when available."
        : "Discovery reads failed; check the local Convex backend and retry."}
    </div>
  );
}

export function DiscoveryPublicPage({
  data,
  query,
  results,
  status,
}: {
  data: PublicDiscoveryData;
  query?: string;
  results: PublicSearchResult[];
  status: DiscoveryStatus;
}) {
  const hasQuery = Boolean(query?.trim());

  return (
    <main className="min-h-screen px-6 py-8 text-foreground sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <nav className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link className="font-mono uppercase tracking-[0.28em] text-muted" href="/">
            VRDex
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link className="rounded-full border border-border bg-surface px-4 py-2 font-medium" href="/submit">
              Add profile
            </Link>
            <Link className="rounded-full border border-border bg-surface px-4 py-2 font-medium" href="/events/new">
              Add event
            </Link>
          </div>
        </nav>

        <section className="overflow-hidden rounded-[2.2rem] bg-[#221512] text-white shadow-[0_28px_90px_rgba(64,40,24,0.18)]">
          <div className="grid gap-8 bg-[radial-gradient(circle_at_top_left,rgba(214,106,77,0.34),transparent_34%),linear-gradient(135deg,#221512,#7c321f)] px-6 py-8 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:px-10 lg:py-12">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/68">
                Search the VRChat scene
              </p>
              <h1 className="mt-4 text-5xl leading-none font-semibold tracking-[-0.055em] sm:text-7xl">
                Find the night, the people, and the worlds behind it.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-white/76 sm:text-lg">
                VRDex discovery combines trustworthy public profiles, event posters, world context, and source-aware ranking without pretending unverified data is official.
              </p>
              <DiscoverySearchForm defaultQuery={query} />
              <div className="mt-5 flex flex-wrap gap-2">
                {data.terms.slice(0, 8).map((term) => (
                  <TrackedDiscoveryLink
                    className="rounded-full bg-white/14 px-3 py-1 text-xs text-white/78 transition hover:bg-white/22"
                    eventName="discovery_filter_selected"
                    href={`/discover?q=${encodeURIComponent(term.label)}`}
                    key={`${term.scope}-${term.key}`}
                    properties={{ scope: term.scope, term: term.label, surface: "hero_terms" }}
                  >
                    {term.label}
                  </TrackedDiscoveryLink>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {data.featured.slice(0, 2).map((result) => (
                <PosterCard key={`${result.entityType}-${result.slug}`} result={result} />
              ))}
            </div>
          </div>
        </section>

        {status === "live" ? null : <DiscoveryBackendNotice kind={status} />}

        {hasQuery ? (
          <Section
            empty="No public results matched that search yet."
            eyebrow="Search results"
            results={results}
            title={`Results for “${query}”`}
          />
        ) : null}

        <Section
          empty="No upcoming events are public yet."
          eyebrow="Tonight and soon"
          results={data.upcomingEvents}
          title="Events worth checking first"
        />

        <section className="grid gap-5 xl:grid-cols-3">
          <Section empty="No people are discoverable yet." eyebrow="People" results={data.people} title="People" />
          <Section
            empty="No communities are discoverable yet."
            eyebrow="Communities"
            results={data.communities}
            title="Communities"
          />
          <Section empty="No worlds are discoverable yet." eyebrow="Worlds" results={data.worlds} title="Worlds" />
        </section>
      </div>
    </main>
  );
}
