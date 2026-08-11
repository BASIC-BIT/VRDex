import { fetchPublicEventBySlug } from "@/convex/server";
import { createPublicEventIcs, publicEventIcsFilename } from "@/lib/calendar/ics";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const result = await fetchPublicEventBySlug(slug);

  if (result.kind === "missing-url" || result.kind === "error") {
    return textResponse("Calendar export is not available.", 503);
  }

  if (result.event === null) {
    return textResponse("Event not found.", 404);
  }

  const canonicalUrl = new URL(`/${result.event.slug}`, request.url).href;
  const body = createPublicEventIcs(result.event, { canonicalUrl });

  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=60",
      "Content-Disposition": `attachment; filename="${publicEventIcsFilename(result.event.slug)}"`,
      "Content-Type": "text/calendar; charset=utf-8",
    },
  });
}

function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
