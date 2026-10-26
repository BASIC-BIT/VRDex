import { redirect } from "next/navigation";

import { HomeSearchPage } from "./_components/home-search-page";
import { searchHref } from "./_components/search-view-state";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<{
    q?: string;
  }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  if (query) redirect(searchHref({ query, view: "dj" }));

  return <HomeSearchPage />;
}
