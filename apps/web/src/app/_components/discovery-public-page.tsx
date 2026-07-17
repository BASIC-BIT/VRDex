import Link from "next/link";

import { DiscoverySearchForm, TrackedDiscoveryLink } from "./discovery-analytics";
import { HomeActiveWorldsSection, type PublicActiveWorld } from "./home-active-worlds";
import { ViewerLocalEventDateTime } from "./viewer-local-event-times";
import { buttonVariants } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { EntityImage } from "@/components/ui/entity-image";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { cn } from "@/lib/cn";
import type { DiscoveryAnalyticsSurface } from "@/lib/posthog";

type EntityType = "profile" | "world" | "event";
type ProfileType = "person" | "community";
export type SearchResultFilter = "all" | "event" | "person" | "community" | "world";

export type PublicSearchResult = {
  entityType: EntityType;
  profileType?: ProfileType;
  slug: string;
  routePath: string;
  title: string;
  subtitle?: string;
  summary?: string;
  imageUrl?: string;
  profileImageUrl?: string;
  logoImageUrl?: string;
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

function resultSubtitle(result: PublicSearchResult): string | undefined {
  const subtitle = result.subtitle?.trim();

  if (!subtitle) {
    return undefined;
  }

  const label = entityLabel(result).toLowerCase();
  const redundantLabels = [label, `${label} profile`];

  return redundantLabels.includes(subtitle.toLowerCase()) ? undefined : subtitle;
}

function resultMatchesFilter(result: PublicSearchResult, filter: SearchResultFilter): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "person" || filter === "community") {
    return result.entityType === "profile" && result.profileType === filter;
  }

  return result.entityType === filter;
}

function ResultImage({ result }: { result: PublicSearchResult }) {
  const primaryImageUrl = result.entityType === "profile"
    ? result.profileImageUrl ?? result.imageUrl
    : result.imageUrl;

  if (
    result.entityType !== "profile" ||
    !result.logoImageUrl ||
    !result.profileImageUrl ||
    result.logoImageUrl === result.profileImageUrl
  ) {
    return (
      <EntityImage
        className="size-14 rounded-card bg-[linear-gradient(135deg,var(--canvas-muted),var(--surface-raised))] text-lg text-white"
        label={result.title}
        sizes="56px"
        src={primaryImageUrl}
      />
    );
  }

  return (
    <span className="grid shrink-0 grid-cols-2 gap-1">
      <EntityImage
        className="size-14 rounded-card bg-[linear-gradient(135deg,var(--canvas-muted),var(--surface-raised))] text-lg text-white"
        label={result.title}
        sizes="56px"
        src={result.profileImageUrl}
      />
      <EntityImage
        className="size-14 rounded-card border border-border bg-surface-strong text-xs"
        fallback="Logo"
        imageClassName="!object-contain p-1"
        label={`${result.title} logo`}
        sizes="56px"
        src={result.logoImageUrl}
        title="Logo"
      />
    </span>
  );
}

function TopNav() {
  return (
    <PageNav>
      <BrandLink />
    </PageNav>
  );
}

function DiscoveryCard({
  result,
  surface,
}: {
  result: PublicSearchResult;
  surface: DiscoveryAnalyticsSurface;
}) {
  const subtitle = resultSubtitle(result);

  return (
    <TrackedDiscoveryLink
      className="group flex gap-4 rounded-panel border border-border bg-surface px-4 py-4 transition hover:-translate-y-1 hover:border-border-strong hover:bg-surface-strong hover:shadow-panel"
      eventName={result.entityType === "event" ? "event_card_clicked" : "search_result_clicked"}
      href={result.routePath}
      properties={{
        entity_type: result.entityType,
        profile_type: result.profileType,
        surface,
      }}
    >
      <ResultImage result={result} />
      <span className="flex min-w-0 flex-col gap-2">
        {result.startsAt === undefined ? null : <ViewerLocalEventDateTime className="text-sm font-medium text-accent-strong" timestamp={result.startsAt} />}
        <span className="text-xl font-semibold group-hover:text-accent-strong">
          {result.title}
        </span>
        {subtitle ? <span className="text-sm text-muted">{subtitle}</span> : null}
        {result.summary ? <span className="line-clamp-2 text-sm leading-6 text-muted">{result.summary}</span> : null}
      </span>
    </TrackedDiscoveryLink>
  );
}

function SearchResultCard({ result }: { result: PublicSearchResult }) {
  const subtitle = resultSubtitle(result);

  return (
    <TrackedDiscoveryLink
      className="group flex gap-4 rounded-panel border border-border bg-surface px-4 py-4 transition hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-strong hover:shadow-panel"
      eventName={result.entityType === "event" ? "event_card_clicked" : "search_result_clicked"}
      href={result.routePath}
      properties={{
        entity_type: result.entityType,
        profile_type: result.profileType,
        surface: "search_results",
      }}
    >
      <ResultImage result={result} />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex items-start justify-between gap-4">
          <span className="min-w-0 text-xl font-semibold group-hover:text-accent-strong">
            {result.title}
          </span>
          <span className="shrink-0 rounded-control border border-border bg-surface-strong px-3 py-1 text-xs font-medium text-muted">
            {entityLabel(result)}
          </span>
        </span>
        {subtitle ? <span className="text-sm text-muted">{subtitle}</span> : null}
        {result.startsAt === undefined ? null : <ViewerLocalEventDateTime className="text-sm text-accent-strong" timestamp={result.startsAt} />}
        {result.summary ? <span className="line-clamp-2 text-sm leading-6 text-muted">{result.summary}</span> : null}
        {result.source ? <span className="text-xs text-muted">{result.source.label}</span> : null}
      </span>
    </TrackedDiscoveryLink>
  );
}

function FeaturedProfileCard({ result }: { result: PublicSearchResult }) {
  return (
    <TrackedDiscoveryLink
      className="group grid h-full min-h-72 min-w-0 overflow-hidden rounded-hero border border-border bg-canvas text-white shadow-hero lg:grid-cols-[18rem_minmax(0,1fr)]"
      eventName="featured_card_clicked"
      href={result.routePath}
      properties={{ entity_type: result.entityType, surface: "featured" }}
    >
      <EntityImage
        className="aspect-square h-auto w-full rounded-none bg-media text-4xl text-white lg:size-72"
        label={result.title}
        sizes="(min-width: 1024px) 288px, (min-width: 768px) 50vw, 100vw"
        src={result.imageUrl}
      />
      <span className="flex min-w-0 flex-col justify-end bg-[linear-gradient(145deg,var(--background),var(--surface-raised))] p-5">
        <span className="block text-3xl font-semibold">{result.title}</span>
        {result.summary ? <span className="mt-3 line-clamp-3 block text-sm leading-6 text-white/76">{result.summary}</span> : null}
      </span>
    </TrackedDiscoveryLink>
  );
}

function PosterCard({ result }: { result: PublicSearchResult }) {
  if (result.entityType === "profile") {
    return <FeaturedProfileCard result={result} />;
  }

  return (
    <TrackedDiscoveryLink
      className="group relative grid aspect-[4/3] min-h-72 min-w-0 overflow-hidden rounded-hero border border-border bg-media text-white shadow-hero"
      eventName="featured_card_clicked"
      href={result.routePath}
      properties={{ entity_type: result.entityType, surface: "featured" }}
    >
      <EntityImage className="absolute inset-0 size-full rounded-none bg-media text-4xl text-white" label={result.title} sizes="(min-width: 768px) 50vw, 100vw" src={result.imageUrl} />
      <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--media)_18%,transparent),color-mix(in_srgb,var(--media)_94%,transparent))]" />
      <span className="relative flex flex-col justify-end self-stretch p-5">
        <span className="block text-3xl font-semibold">{result.title}</span>
        {result.summary ? <span className="mt-3 line-clamp-3 block text-sm leading-6 text-white/76">{result.summary}</span> : null}
      </span>
    </TrackedDiscoveryLink>
  );
}

function DiscoverySection({
  title,
  empty,
  columns = "responsive",
  results,
  surface,
}: {
  title: string;
  empty: string;
  columns?: "responsive" | "single";
  results: PublicSearchResult[];
  surface: DiscoveryAnalyticsSurface;
}) {
  return (
    <section className="min-w-0 border-t border-border pt-6">
      <SectionTitle>{title}</SectionTitle>
      <div className={cn("mt-5 grid gap-4", columns === "responsive" ? "lg:grid-cols-2" : undefined)}>
        {results.length === 0 ? (
          <p className="text-sm leading-6 text-muted">{empty}</p>
        ) : (
          results.map((result) => (
            <DiscoveryCard
              key={`${result.entityType}-${result.slug}`}
              result={result}
              surface={surface}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function DiscoveryBackendNotice({ kind }: { kind: "missing-url" | "error" }) {
  return (
    <div className="rounded-panel border border-dashed border-white/25 bg-white/14 px-5 py-4 text-sm leading-6 text-white/78">
      {kind === "missing-url" ? "Discovery data is not available in this environment yet." : "Discovery data is temporarily unavailable."}
    </div>
  );
}

export function DiscoveryLandingPage({
  activeWorldStatus,
  activeWorlds,
  data,
  status,
}: {
  activeWorldStatus: DiscoveryStatus;
  activeWorlds: PublicActiveWorld[];
  data: PublicDiscoveryData;
  status: DiscoveryStatus;
}) {
  return (
    <PageShell>
      <PageContainer className="gap-8" max="7xl">
        <TopNav />

        <section className="grid gap-6 border-b border-border py-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-end lg:py-12">
          <div>
            <h1 className="max-w-md text-4xl leading-none font-semibold sm:text-5xl">
              Tonight in VRChat
            </h1>
          </div>
          <DiscoverySearchForm className="w-full" surface="home" tone="default" />
        </section>

        {status === "live" ? null : <DiscoveryBackendNotice kind={status} />}

        <DiscoverySection
          empty="No upcoming events are public yet."
          results={data.upcomingEvents}
          surface="upcoming_events"
          title="Upcoming events"
        />

        <HomeActiveWorldsSection status={activeWorldStatus} worlds={activeWorlds} />

        {data.featured.length > 0 ? (
          <section className="min-w-0 border-t border-border pt-6">
            <SectionTitle>Featured</SectionTitle>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {data.featured.slice(0, 2).map((result) => <PosterCard key={`${result.entityType}-${result.slug}`} result={result} />)}
            </div>
          </section>
        ) : null}

        <section className="grid gap-5 xl:grid-cols-3">
          <DiscoverySection columns="single" empty="No people are discoverable yet." results={data.people} surface="home" title="People" />
          <DiscoverySection columns="single" empty="No communities are discoverable yet." results={data.communities} surface="home" title="Communities" />
          <DiscoverySection columns="single" empty="No worlds are discoverable yet." results={data.worlds} surface="home" title="Worlds" />
        </section>
      </PageContainer>
    </PageShell>
  );
}

function filterHref(query: string, filter: SearchResultFilter) {
  const params = new URLSearchParams({ q: query });

  if (filter !== "all") {
    params.set("type", filter);
  }

  return `/search?${params.toString()}`;
}

function filterLabel(filter: SearchResultFilter): string {
  switch (filter) {
    case "event":
      return "Events";
    case "person":
      return "People";
    case "community":
      return "Communities";
    case "world":
      return "Worlds";
    default:
      return "All";
  }
}

export function SearchResultsPage({
  activeFilter,
  query,
  results,
  status,
}: {
  activeFilter: SearchResultFilter;
  query: string;
  results: PublicSearchResult[];
  status: DiscoveryStatus;
}) {
  const hasQuery = Boolean(query.trim());
  const filteredResults = results.filter((result) => resultMatchesFilter(result, activeFilter));
  const filters: SearchResultFilter[] = ["all", "event", "person", "community", "world"];

  return (
    <PageShell>
      <PageContainer className="gap-7" max="5xl">
        <TopNav />

        <section className="pt-4">
          <h1 className="text-4xl leading-none font-semibold sm:text-6xl">
            {hasQuery ? `Results for ${query}` : "Search VRDex"}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted sm:text-base">
            Search across public people, communities, worlds, and events.
          </p>
          <DiscoverySearchForm className="mt-6 max-w-3xl" defaultQuery={query} surface="search" tone="default" />
        </section>

        {status === "live" ? null : <Card surface="dashed">{status === "missing-url" ? "Search data is not available in this environment yet." : "Search data is temporarily unavailable."}</Card>}

        {hasQuery ? (
          <section aria-label="Search results" className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {filters.map((filter) => {
                  const count = results.filter((result) => resultMatchesFilter(result, filter)).length;
                  const active = filter === activeFilter;

                  return (
                    <Link
                      className={cn(
                        buttonVariants({ size: "sm", variant: active ? "primary" : "secondary" }),
                        count === 0 ? "pointer-events-none opacity-50" : undefined,
                      )}
                      href={filterHref(query, filter)}
                      key={filter}
                    >
                      {filterLabel(filter)} {count}
                    </Link>
                  );
                })}
              </div>
              <p className="text-sm text-muted">
                {filteredResults.length} {filteredResults.length === 1 ? "result" : "results"}
              </p>
            </div>

            {filteredResults.length === 0 ? (
              <Card surface="dashed">
                <p className="font-medium">No public results matched that search yet.</p>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Try a community name, DJ alias, world name, event title, genre, or scene term.
                </p>
              </Card>
            ) : (
              <div className="grid gap-4">
                {filteredResults.map((result) => <SearchResultCard key={`${result.entityType}-${result.slug}`} result={result} />)}
              </div>
            )}
          </section>
        ) : (
          <Card surface="glass">
            <p className="font-medium">Start with a name, scene, world, genre, or event.</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              Search is for direct intent; the homepage stays focused on discovery and what is coming up.
            </p>
          </Card>
        )}
      </PageContainer>
    </PageShell>
  );
}
