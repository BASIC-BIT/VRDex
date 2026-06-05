import { redirect } from "next/navigation";

type DiscoverRedirectPageProps = {
  searchParams: Promise<{
    q?: string | string[];
    type?: string | string[];
  }>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DiscoverRedirectPage({ searchParams }: DiscoverRedirectPageProps) {
  const params = await searchParams;
  const query = firstParam(params.q)?.trim();

  if (!query) {
    redirect("/");
  }

  const nextParams = new URLSearchParams({ q: query });
  const type = firstParam(params.type)?.trim();

  if (type) {
    nextParams.set("type", type);
  }

  redirect(`/search?${nextParams.toString()}`);
}
