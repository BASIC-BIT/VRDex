import { ProfileLookupPage } from "./_components/profile-lookup-page";
import { fetchProfileLookup } from "@/convex/server";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<{
    q?: string;
  }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const lookup = await fetchProfileLookup(query);

  return (
    <ProfileLookupPage
      privateResults={lookup.privateResults}
      query={query}
      results={lookup.results}
      routePath="/"
      status={lookup.kind}
      viewerAccess={lookup.viewerAccess}
    />
  );
}
