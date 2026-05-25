import { notFound } from "next/navigation";

import { WorldBackendNotice, WorldPublicPage } from "../../_components/world-public-page";
import { fetchPublicWorldBySlug } from "@/convex/server";

export const dynamic = "force-dynamic";

type WorldPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function WorldProfilePage({ params }: WorldPageProps) {
  const { slug } = await params;
  const result = await fetchPublicWorldBySlug(slug);

  if (result.kind === "missing-url" || result.kind === "error") {
    return <WorldBackendNotice kind={result.kind} />;
  }

  if (result.world === null) {
    notFound();
  }

  return <WorldPublicPage world={result.world} />;
}
