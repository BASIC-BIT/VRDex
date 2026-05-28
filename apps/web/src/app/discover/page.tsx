import { DiscoveryPublicPage } from "../_components/discovery-public-page";
import { fetchDiscovery, fetchDiscoverySearch } from "@/convex/server";

export const dynamic = "force-dynamic";

type DiscoverPageProps = {
  searchParams: Promise<{
    q?: string;
  }>;
};

export default async function DiscoverPage({ searchParams }: DiscoverPageProps) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const [discovery, search] = await Promise.all([
    fetchDiscovery(),
    query ? fetchDiscoverySearch(query) : Promise.resolve({ kind: "live" as const, results: [] }),
  ]);
  const status = discovery.kind === "live" ? search.kind : discovery.kind;

  return (
    <DiscoveryPublicPage
      data={discovery.data}
      query={query}
      results={search.results}
      status={status}
    />
  );
}
