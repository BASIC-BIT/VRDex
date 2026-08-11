import { notFound } from "next/navigation";

import { validateSlugFormat } from "../../../../../convex/_globalSlugs";
import { EventPublicPage } from "../_components/event-public-page";
import { ProfileBackendNotice, ProfilePublicPage } from "../_components/profile-public-page";
import { WorldPublicPage } from "../_components/world-public-page";
import { fetchPublicEntityBySlug } from "@/convex/server";

export const dynamic = "force-dynamic";

type EntityPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

// Profiles, worlds, and events are all first-class root links -- vrdex.net/basicbit --
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
    // Shared across all three entity types: at this point the lookup failed, so which
    // kind of thing the slug names is exactly what we do not know.
    return <ProfileBackendNotice kind={result.kind} />;
  }

  if (result.entity === null) {
    notFound();
  }

  switch (result.entity.type) {
    case "profile":
      return <ProfilePublicPage profile={result.entity.profile} />;
    case "world":
      return <WorldPublicPage world={result.entity.world} />;
    case "event":
      return <EventPublicPage event={result.entity.event} showEditLink />;
  }
}
