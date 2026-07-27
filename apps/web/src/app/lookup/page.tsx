import { redirect } from "next/navigation";

import { searchHref } from "../_components/search-view-state";

export const dynamic = "force-dynamic";

type LookupPageProps = {
  searchParams: Promise<{
    q?: string;
  }>;
};

export default async function LookupPage({ searchParams }: LookupPageProps) {
  const { q } = await searchParams;
  redirect(searchHref({ query: q, view: "dj" }));
}
