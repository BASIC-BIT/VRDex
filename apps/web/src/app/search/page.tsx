import { SearchResultsPage, type SearchResultFilter } from "../_components/discovery-public-page";
import { fetchDiscoverySearch } from "@/convex/server";

export const dynamic = "force-dynamic";

type SearchPageProps = {
  searchParams: Promise<{
    q?: string;
    type?: string;
  }>;
};

const searchFilters = new Set<SearchResultFilter>(["all", "event", "person", "community", "world"]);

function parseSearchFilter(value: string | undefined): SearchResultFilter {
  return value && searchFilters.has(value as SearchResultFilter) ? (value as SearchResultFilter) : "all";
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q, type } = await searchParams;
  const query = q?.trim() ?? "";
  const search = query ? await fetchDiscoverySearch(query) : { kind: "live" as const, results: [] };

  return (
    <SearchResultsPage
      activeFilter={parseSearchFilter(type)}
      query={query}
      results={search.results}
      status={search.kind}
    />
  );
}
