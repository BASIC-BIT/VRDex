import { readEventArtwork } from "@/lib/server/event-intake-api";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ slug: string; artworkAssetId: string }> }) {
  const { slug: eventId, artworkAssetId } = await context.params;
  return readEventArtwork(eventId, artworkAssetId);
}
