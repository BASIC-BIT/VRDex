import Link from "next/link";

import { DiscoverySearchForm, TrackedDiscoveryLink } from "./discovery-analytics";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow, SectionTitle } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { cn } from "@/lib/cn";
import { safeImageBackground } from "@/lib/safe-image";

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

function DiscoveryCard({ result, surface }: { result: PublicSearchResult; surface: string }) {
  const imageStyle = safeImageBackground(result.imageUrl);
  const time = formatEventTime(result.startsAt);

  return (
    <TrackedDiscoveryLink
      className="group grid gap-4 rounded-panel border border-border bg-surface px-4 py-4 transition hover:-translate-y-1 hover:shadow-panel sm:grid-cols-[8rem_1fr]"
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
        className="flex aspect-[4/3] items-center justify-center rounded-card bg-[linear-gradient(135deg,#2f211b,#d66a4d)] bg-cover bg-center text-2xl font-semibold text-white"
        style={imageStyle}
      >
        {!imageStyle ? initialsFor(result.title) : null}
      </span>
      <span className="flex min-w-0 flex-col gap-3">
        <span className="flex flex-wrap items-center gap-2">
          <Badge mono variant="default">
            {entityLabel(result)}
          </Badge>
          {time ? (
            <Badge variant="accent">
              {time}
            </Badge>
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
  const imageStyle = safeImageBackground(result.imageUrl);

  return (
    <TrackedDiscoveryLink
      className="group min-h-80 overflow-hidden rounded-hero border border-white/15 bg-[#241814] text-white shadow-hero"
      eventName="featured_card_clicked"
      href={result.routePath}
      properties={{ entity_type: result.entityType, result_slug: result.slug, surface: "featured" }}
    >
      <span
        className="flex min-h-80 flex-col justify-end bg-[radial-gradient(circle_at_top_left,rgba(214,106,77,0.45),transparent_34%),linear-gradient(145deg,#221512,#74311f)] bg-cover bg-center p-5"
        style={imageStyle}
      >
        <Badge mono variant="inverse">
          Featured {entityLabel(result)}
        </Badge>
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
    <Card className="backdrop-blur" surface="glass">
      <Eyebrow>{eyebrow}</Eyebrow>
      <SectionTitle className="mt-3">{title}</SectionTitle>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {results.length === 0 ? (
          <p className="text-sm leading-6 text-muted">{empty}</p>
        ) : (
          results.map((result) => (
            <DiscoveryCard key={`${result.entityType}-${result.slug}`} result={result} surface={eyebrow} />
          ))
        )}
      </div>
    </Card>
  );
}

export function DiscoveryBackendNotice({ kind }: { kind: "missing-url" | "error" }) {
  return (
    <div className="rounded-panel border border-dashed border-white/25 bg-white/14 px-5 py-4 text-sm leading-6 text-white/78">
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
    <PageShell>
      <PageContainer className="gap-8" max="7xl">
        <PageNav>
          <BrandLink />
          <div className="flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: "secondary" })} href="/submit">
              Add profile
            </Link>
            <Link className={buttonVariants({ variant: "secondary" })} href="/events/new">
              Add event
            </Link>
          </div>
        </PageNav>

        <section className="overflow-hidden rounded-hero bg-[#221512] text-white shadow-hero">
          <div className="grid gap-8 bg-[radial-gradient(circle_at_top_left,rgba(214,106,77,0.34),transparent_34%),linear-gradient(135deg,#221512,#7c321f)] px-6 py-8 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:px-10 lg:py-12">
            <div>
              <Eyebrow tone="inverse">Search the VRChat scene</Eyebrow>
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
                    className={cn(badgeVariants({ variant: "inverseMuted" }), "transition hover:bg-white/22")}
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
      </PageContainer>
    </PageShell>
  );
}
