import { SearchResultsPage } from "../_components/discovery-public-page";
import { ProfileLookupPage } from "../_components/profile-lookup-page";
import {
  parseSearchFilter,
  parseSearchView,
} from "../_components/search-view-state";
import { fetchDiscoverySearch, fetchProfileLookup } from "@/convex/server";

export const dynamic = "force-dynamic";

type SearchPageProps = {
  searchParams: Promise<{
    q?: string;
    type?: string;
    view?: string;
  }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q, type, view: rawView } = await searchParams;
  const query = q?.trim() ?? "";
  const view = parseSearchView(rawView);
  const filter = parseSearchFilter(type, view);

  if (view === "dj") {
    const lookup = await fetchProfileLookup(query);

    return (
      <ProfileLookupPage
        privateResults={lookup.privateResults}
        query={query}
        results={lookup.results}
        routePath="/search"
        status={lookup.kind}
        title="DJ links"
        view="dj"
        viewerAccess={lookup.viewerAccess}
      />
    );
  }

  const search = query
    ? await fetchDiscoverySearch(query, filter)
    : { kind: "live" as const, results: [] };

  return (
    <SearchResultsPage
      activeFilter={filter}
      query={query}
      results={search.results}
      status={search.kind}
    />
  );
}
