import type { RenditionSnapshot } from "../contracts";
import type { SignSegment } from "./signing";

export function renderPlaylist(
  snapshot: RenditionSnapshot,
  signSegment: SignSegment,
  expiresAt: number,
): string {
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${Math.ceil(snapshot.targetDurationSeconds)}`,
    `#EXT-X-MEDIA-SEQUENCE:${snapshot.sequence}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${snapshot.discontinuitySequence}`,
  ];
  for (const segment of snapshot.segments) {
    if (segment.discontinuity) lines.push("#EXT-X-DISCONTINUITY");
    const url = signSegment({ objectKey: segment.objectKey, expiresAt });
    // Prevent playlist tag injection even if a deployment supplies a bad signer.
    if (/[\r\n]/.test(url) || new URL(url).protocol !== "https:")
      throw Error("Invalid segment URL");
    lines.push(
      `#EXT-X-PROGRAM-DATE-TIME:${new Date(segment.programDateTime).toISOString()}`,
      `#EXTINF:${segment.durationSeconds.toFixed(6)},`,
      url,
    );
  }
  return `${lines.join("\n")}\n`;
}
