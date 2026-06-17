import Link from "next/link";

import { DiscoverySearchForm, TrackedDiscoveryLink } from "./discovery-analytics";
import { HomeActiveWorldsSection, type PublicActiveWorld } from "./home-active-worlds";
import { ViewerLocalEventDateTime } from "./viewer-local-event-times";
import { buttonVariants } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { cn } from "@/lib/cn";
import { safeImageBackground } from "@/lib/safe-image";

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

const discoveryThumbOverlay = "linear-gradient(135deg, rgba(47, 33, 27, 0.74), rgba(214, 106, 77, 0.7))";
const featuredPosterOverlay = "radial-gradient(circle at top left, rgba(214, 106, 77, 0.45), transparent 34%), linear-gradient(145deg, #221512, #74311f)";

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

function initialsFor(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "VR"
  );
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
  const imageStyle = safeImageBackground(result.imageUrl, discoveryThumbOverlay);

  if (
    result.entityType !== "profile" ||
    !result.logoImageUrl ||
    !result.profileImageUrl ||
    result.logoImageUrl === result.profileImageUrl
  ) {
    return (
      <span
        className="flex size-14 shrink-0 items-center justify-center rounded-card bg-[linear-gradient(135deg,#2f211b,#d66a4d)] bg-cover bg-center text-lg font-semibold text-white"
        style={imageStyle}
      >
        {!imageStyle ? initialsFor(result.title) : null}
      </span>
    );
  }

  const profileImageStyle = safeImageBackground(result.profileImageUrl, discoveryThumbOverlay);
  const logoStyle = safeImageBackground(result.logoImageUrl);

  return (
    <span className="grid shrink-0 grid-cols-2 gap-1">
      <span
        className="flex size-14 items-center justify-center rounded-card bg-[linear-gradient(135deg,#2f211b,#d66a4d)] bg-cover bg-center text-lg font-semibold text-white"
        style={profileImageStyle}
        title="Profile image"
      >
        {!profileImageStyle ? initialsFor(result.title) : null}
      </span>
      <span
        className="flex size-14 items-center justify-center rounded-card border border-border bg-surface-strong bg-contain bg-center bg-no-repeat text-xs font-semibold text-muted"
        style={logoStyle}
        title="Logo"
      >
        {!logoStyle ? "Logo" : null}
      </span>
    </span>
  );
}

function TopNav() {
  return (
    <PageNav>
      <BrandLink />
      <div className="flex flex-wrap gap-2">
        <Link className={buttonVariants({ variant: "secondary" })} href="/lookup">
          Lookup links
        </Link>
        <Link className={buttonVariants({ variant: "secondary" })} href="/submit">
          Add profile
        </Link>
        <Link className={buttonVariants({ variant: "secondary" })} href="/events/new">
          Add event
        </Link>
      </div>
    </PageNav>
  );
}

function DiscoveryCard({ result, surface }: { result: PublicSearchResult; surface: string }) {
  const subtitle = resultSubtitle(result);

  return (
    <TrackedDiscoveryLink
      className="group flex gap-4 rounded-panel border border-border bg-surface px-4 py-4 transition hover:-translate-y-1 hover:shadow-panel"
      eventName={result.entityType === "event" ? "event_card_clicked" : "search_result_clicked"}
      href={result.routePath}
      properties={{
        entity_type: result.entityType,
        profile_type: result.profileType,
        result_slug: result.slug,
        surface,
      }}
    >
      <ResultImage result={result} />
      <span className="flex min-w-0 flex-col gap-2">
        {result.startsAt === undefined ? null : <ViewerLocalEventDateTime className="text-sm font-medium text-accent-strong" timestamp={result.startsAt} />}
        <span className="text-xl font-semibold tracking-[-0.03em] group-hover:text-accent-strong">
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
      className="group flex gap-4 rounded-panel border border-border bg-surface px-4 py-4 transition hover:-translate-y-0.5 hover:shadow-panel"
      eventName={result.entityType === "event" ? "event_card_clicked" : "search_result_clicked"}
      href={result.routePath}
      properties={{
        entity_type: result.entityType,
        profile_type: result.profileType,
        result_slug: result.slug,
        surface: "search_results",
      }}
    >
      <ResultImage result={result} />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex items-start justify-between gap-4">
          <span className="min-w-0 text-xl font-semibold tracking-[-0.03em] group-hover:text-accent-strong">
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

function PosterCard({ result }: { result: PublicSearchResult }) {
  const imageStyle = safeImageBackground(result.imageUrl, featuredPosterOverlay);

  return (
    <TrackedDiscoveryLink
      className="group h-full min-h-72 overflow-hidden rounded-hero border border-white/15 bg-[#241814] text-white shadow-hero"
      eventName="featured_card_clicked"
      href={result.routePath}
      properties={{ entity_type: result.entityType, result_slug: result.slug, surface: "featured" }}
    >
      <span
        className="flex h-full min-h-72 flex-col justify-end bg-[radial-gradient(circle_at_top_left,rgba(214,106,77,0.45),transparent_34%),linear-gradient(145deg,#221512,#74311f)] bg-cover bg-center p-5"
        style={imageStyle}
      >
        <span className="block text-3xl font-semibold tracking-[-0.04em]">{result.title}</span>
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
}: {
  title: string;
  empty: string;
  columns?: "responsive" | "single";
  results: PublicSearchResult[];
}) {
  return (
    <Card className="backdrop-blur" surface="glass">
      <SectionTitle>{title}</SectionTitle>
      <div className={cn("mt-5 grid gap-4", columns === "responsive" ? "lg:grid-cols-2" : undefined)}>
        {results.length === 0 ? (
          <p className="text-sm leading-6 text-muted">{empty}</p>
        ) : (
          results.map((result) => <DiscoveryCard key={`${result.entityType}-${result.slug}`} result={result} surface={title} />)
        )}
      </div>
    </Card>
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

        <section className="overflow-hidden rounded-hero bg-[#221512] text-white shadow-hero">
          <div className="bg-[radial-gradient(circle_at_top_left,rgba(214,106,77,0.34),transparent_34%),linear-gradient(135deg,#221512,#7c321f)] px-6 py-10 text-center sm:px-8 lg:px-14 lg:py-16">
            <div className="mx-auto max-w-4xl">
              <h1 className="text-5xl leading-none font-semibold tracking-[-0.055em] sm:text-7xl">
                Find the night, the people, and the worlds behind it.
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-white/76 sm:text-lg">
                Search VRChat communities, DJs, worlds, and events from one public scene map.
              </p>
              <DiscoverySearchForm className="mx-auto mt-8 w-full max-w-3xl" surface="home" />
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {data.terms.slice(0, 8).map((term) => (
                  <TrackedDiscoveryLink
                    className={cn(buttonVariants({ size: "sm", variant: "inverse" }), "bg-white/10")}
                    eventName="discovery_filter_selected"
                    href={`/search?q=${encodeURIComponent(term.label)}`}
                    key={`${term.scope}-${term.key}`}
                    properties={{ scope: term.scope, term: term.label, surface: "home_terms" }}
                  >
                    {term.label}
                  </TrackedDiscoveryLink>
                ))}
              </div>
            </div>
          </div>
        </section>

        {status === "live" ? null : <DiscoveryBackendNotice kind={status} />}

        <DiscoverySection
          empty="No upcoming events are public yet."
          results={data.upcomingEvents}
          title="Events worth checking first"
        />

        <HomeActiveWorldsSection status={activeWorldStatus} worlds={activeWorlds} />

        {data.featured.length > 0 ? (
          <Card className="backdrop-blur" surface="glass">
            <SectionTitle>Featured picks</SectionTitle>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {data.featured.slice(0, 2).map((result) => <PosterCard key={`${result.entityType}-${result.slug}`} result={result} />)}
            </div>
          </Card>
        ) : null}

        <section className="grid gap-5 xl:grid-cols-3">
          <DiscoverySection columns="single" empty="No people are discoverable yet." results={data.people} title="People" />
          <DiscoverySection columns="single" empty="No communities are discoverable yet." results={data.communities} title="Communities" />
          <DiscoverySection columns="single" empty="No worlds are discoverable yet." results={data.worlds} title="Worlds" />
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
          <h1 className="text-4xl leading-none font-semibold tracking-[-0.045em] sm:text-6xl">
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
