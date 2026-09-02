import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { validateSlugFormat } from "../../../../../convex/_globalSlugs";
import { EntityBackendNotice } from "./entity-backend-notice";
import { ProfilePublicPage } from "../_components/profile-public-page";
import { WorldPublicPage } from "../_components/world-public-page";
import { fetchPublicEntityBySlug } from "@/convex/server";
import { profileShareMetadata } from "@/lib/profile-share-card";

export const dynamic = "force-dynamic";

type EntityPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export async function generateMetadata({ params }: EntityPageProps): Promise<Metadata> {
  const { slug } = await params;

  if (!validateSlugFormat(slug).ok) {
    return {};
  }

  const result = await fetchPublicEntityBySlug(slug);

  return result.kind === "live"
    && result.entity?.type === "profile"
    && result.entity.shareCard !== null
    ? profileShareMetadata(result.entity.shareCard)
    : {};
}

// Profiles and worlds are first-class root links -- vrdex.net/basicbit --
// so they share one slug namespace and one route. Static segments win over this
// dynamic one in Next's router, and every top-level route name is also held in
// RESERVED_ROUTE_SLUGS so no slug can ever be shadowed by a page.
export default async function EntityPage({ params }: EntityPageProps) {
  const { slug } = await params;

  // Every path the app does not otherwise match lands here, scanner noise included.
  // A string that could never be a slug is a 404 without asking the backend at all.
  if (!validateSlugFormat(slug).ok) {
    notFound();
  }

  const result = await fetchPublicEntityBySlug(slug);

  if (result.kind === "missing-url" || result.kind === "error") {
    // Entity-neutral on purpose: the lookup that would have said whether this slug
    // names a person, a world, or an event is the one that just failed.
    return <EntityBackendNotice />;
  }

  if (result.entity === null) {
    notFound();
  }

  switch (result.entity.type) {
    case "profile":
      return <ProfilePublicPage profile={result.entity.profile} />;
    case "world":
      return <WorldPublicPage world={result.entity.world} />;
  }
}
