import { fetchPublicEventSeries } from "@/convex/server";
import { createPublicEventFeedIcs, publicEventIcsFilename } from "@/lib/calendar/ics";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ seriesId: string; slug: string }> },
) {
  const { seriesId, slug } = await context.params;
  const result = await fetchPublicEventSeries(seriesId);

  if (result.kind === "missing-url" || result.kind === "error") {
    return textResponse("Calendar export is not available.", 503);
  }

  if (result.series === null || result.series.communitySlug !== slug) {
    return textResponse("Event not found.", 404);
  }

  const absolute = (path: string) => new URL(path, request.url).href;
  const body = createPublicEventFeedIcs(result.series.nights, {
    feedName: result.series.title,
    feedUrl: absolute(`/${slug}/series/${result.series.id}`),
    eventUrl: (night) => absolute(`/${slug}/events/${night.slug}`),
  });

  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=60",
      "Content-Disposition": `attachment; filename="${publicEventIcsFilename(seriesId)}"`,
      "Content-Type": "text/calendar; charset=utf-8",
    },
  });
}

function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
