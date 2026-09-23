import type { Doc } from "./_generated/dataModel";
import { publicProfileOutboundLinks } from "./_profilePublic";
import { parseVrcdnStreamLinks } from "./_vrcdnLinks";

export type PlaybackStream = { streamId: string; pcUrl: string; questUrl: string };

export function eventProfileStreamChoices(profile: Doc<"profiles">): PlaybackStream[] {
  const choices = new Map<string, PlaybackStream>();
  for (const link of publicProfileOutboundLinks(profile, "discovery")) {
    const stream = parseVrcdnStreamLinks(link.url);
    if (stream !== null && stream.directVideoUrl === undefined) {
      const { streamId, pcUrl, questUrl } = stream;
      choices.set(streamId, { streamId, pcUrl, questUrl });
    }
  }
  return [...choices.values()];
}

export function resolveEventStream(choices: PlaybackStream[], selectedStreamId?: string): PlaybackStream | undefined {
  return selectedStreamId === undefined
    ? choices.length === 1 ? choices[0] : undefined
    : choices.find((choice) => choice.streamId === selectedStreamId);
}
