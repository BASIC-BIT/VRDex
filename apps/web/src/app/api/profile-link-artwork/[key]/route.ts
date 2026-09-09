import { fetchQuery } from "convex/nextjs";

import { api } from "@convex-generated-api";
import { cachedProfileLinkDestinationArtwork, canonicalDestinationArtworkQuery } from "@/lib/server/profile-link-destination-artwork-cache";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ key: string }> }): Promise<Response> {
  const { key } = await context.params;
  if (key.length > 256) return new Response(null, { status: 404 });
  try {
    // The query rechecks a current public profile/link reference before releasing the source.
    // Callers cannot select an arbitrary origin, URL, or provider image from this endpoint.
    const params = new URL(request.url).searchParams;
    const profileId = params.get("profile");
    if (!profileId || profileId.length > 100) return new Response(null, { status: 404 });
    const surface = params.get("surface");
    if (surface !== null && surface !== "profile_page" && surface !== "discovery") return new Response(null, {status:404});
    const size = params.get("size") === "512" ? 512 : 128;
    const source = await fetchQuery(api.profileLinkDestinations.lookupArtworkSource, { key, profileId, ...(surface ? {surface} : {}), ...(size === 512 ? {profileImage:true} : {}) });
    if (!source) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    if (!canonicalDestinationArtworkQuery(params, source.observedAt)) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    const bytes = await cachedProfileLinkDestinationArtwork({ key, ...source, artworkSourceUrl: source.artworkSourceUrl! }, size);
    if (!bytes) return new Response(null, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "3600" } });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  }
}
