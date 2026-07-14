import { ProfileLookupPage } from "../_components/profile-lookup-page";
import { fetchProfileLookup } from "@/convex/server";

export const dynamic = "force-dynamic";

type LookupPageProps = {
  searchParams: Promise<{
    q?: string;
  }>;
};

export default async function LookupPage({ searchParams }: LookupPageProps) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const lookup = await fetchProfileLookup(query);

  return (
    <ProfileLookupPage
      privateResults={lookup.privateResults}
      query={query}
      results={lookup.results}
      status={lookup.kind}
      viewerAccess={lookup.viewerAccess}
    />
  );
}
