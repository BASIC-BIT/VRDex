import { fetchQuery } from "convex/nextjs";
import { api } from "@convex-generated-api";
import { convexAuthToken } from "@/lib/server/auth";
import { eventDjTarget } from "@/lib/event-dj-target";
import { getEventSourceStatuses } from "@/lib/server/event-source-status";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; eventSlug: string }> },
) {
  const { slug, eventSlug } = await params;
  const token = await convexAuthToken();
  if (!token) return Response.json({}, { status: 401, headers });
  let status;
  try {
    status = await fetchQuery(
      api.events.getEventMediaControlStatus,
      { currentSlug: eventSlug },
      { token },
    );
  } catch {
    return Response.json({}, { status: 404, headers });
  }
  if (status.eventPath !== `/${slug}/events/${eventSlug}`)
    return Response.json({}, { status: 404, headers });
  const query = new URL(request.url).searchParams;
  const raw = query.get("ids") ?? "";
  if (
    [...query.keys()].some((key) => key !== "ids") ||
    query.getAll("ids").length > 1 ||
    raw.length > 1024
  )
    return Response.json({}, { status: 400, headers });
  const ids = raw ? raw.split(",") : [];
  if (
    ids.length > 4 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !id || id.length > 128)
  )
    return Response.json({}, { status: 400, headers });
  const sources = [];
  for (const id of ids) {
    const source = status.sources.find((row) => row.sourceId === id);
    if (!source?.input || !source.publicUrl || !source.hasPublicUrl)
      return Response.json({}, { status: 400, headers });
    const target = eventDjTarget(source.publicUrl);
    if (!target) return Response.json({}, { status: 400, headers });
    sources.push({ key: target.key, url: target.url });
  }
  return Response.json(await getEventSourceStatuses(sources), { headers });
}
