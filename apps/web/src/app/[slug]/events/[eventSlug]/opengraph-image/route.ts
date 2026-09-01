import { createElement } from "react";
import { ImageResponse } from "next/og";

import { EventShareCardImage } from "../../../../_components/event-share-card-image";
import { fetchPublicEventShareCard } from "@/convex/server";
import { eventShareImageSize } from "@/lib/event-share-card";
import { inlineEventShareArtwork } from "@/lib/server/event-share-media";

export const runtime = "nodejs";

type EventShareImageRouteProps = {
  params: Promise<{ eventSlug: string; slug: string }>;
};

export async function GET(
  _request: Request,
  { params }: EventShareImageRouteProps,
) {
  const { eventSlug, slug } = await params;
  const result = await fetchPublicEventShareCard(slug, eventSlug);

  if (result.kind === "live" && result.event === null) {
    return new Response(null, { status: 404 });
  }

  const event = result.kind === "live" ? result.event : null;
  let artworkImageUrl: string | undefined;

  try {
    artworkImageUrl = await inlineEventShareArtwork(event?.artworkImageUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Event share artwork could not be rendered: ${message}`);
  }

  return new ImageResponse(
    createElement(EventShareCardImage, { artworkImageUrl, event }),
    {
      ...eventShareImageSize,
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
