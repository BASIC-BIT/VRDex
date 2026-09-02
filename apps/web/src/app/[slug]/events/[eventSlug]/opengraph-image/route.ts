import { createElement } from "react";
import { ImageResponse } from "next/og";

import { EventShareCardImage } from "../../../../_components/event-share-card-image";
import { fetchPublicEventShareCard } from "@/convex/server";
import { eventShareImageSize, eventShareRevision } from "@/lib/event-share-card";
import { inlineEventShareArtwork } from "@/lib/server/event-share-media";

export const runtime = "nodejs";

type EventShareImageRouteProps = {
  params: Promise<{ eventSlug: string; slug: string }>;
};

export async function GET(
  request: Request,
  { params }: EventShareImageRouteProps,
) {
  const { eventSlug, slug } = await params;
  const result = await fetchPublicEventShareCard(slug, eventSlug);

  if (result.kind !== "live") {
    return new Response(null, {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "30" },
    });
  }

  if (result.event === null) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const event = result.event;
  const requestUrl = new URL(request.url);
  const revisions = requestUrl.searchParams.getAll("revision");
  const hasOnlyRevision = [...requestUrl.searchParams.keys()].every(
    (key) => key === "revision",
  );

  if (
    revisions.length !== 1 ||
    !hasOnlyRevision ||
    revisions[0] !== eventShareRevision(event)
  ) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  let artworkImageUrl: string | undefined;

  try {
    artworkImageUrl = await inlineEventShareArtwork(event.artworkImageUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Event share artwork could not be rendered: ${message}`);
  }

  return new ImageResponse(
    createElement(EventShareCardImage, { artworkImageUrl, event }),
    {
      ...eventShareImageSize,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
