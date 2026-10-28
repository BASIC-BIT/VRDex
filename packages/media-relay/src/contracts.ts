import { z } from "zod";

const opaqueId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const reserved = new Set([
  "about",
  "api",
  "dashboard",
  "login",
  "panel",
  "privacy",
  "status",
  "terms",
  "wiki",
]);
export const StreamIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{2,128}$/)
  .refine((id) => !reserved.has(id.toLowerCase()));
export const StreamKeySchema = z
  .string()
  .refine((value) => {
    const parts = value.split("/");
    return (
      parts.length === 3 &&
      parts[0] === "vrcdn" &&
      parts[2] === "1" &&
      StreamIdSchema.safeParse(parts[1]).success
    );
  })
  .brand<"StreamKey">();
export type StreamKey = z.infer<typeof StreamKeySchema>;
const measurement = z.number().finite().nonnegative();
const integer = z.number().int().nonnegative();
const positiveInteger = integer.positive();
export const PlaybackModeSchema = z.enum(["video", "audio"]);
export type PlaybackMode = z.infer<typeof PlaybackModeSchema>;
export const PublicContextSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("profile"),
    profileId: opaqueId,
    linkId: opaqueId,
  }),
  z.strictObject({
    kind: z.literal("event"),
    eventId: opaqueId,
    selectedSourceId: opaqueId,
  }),
]);
export type PublicContext = z.infer<typeof PublicContextSchema>;
export const SourceDescriptorSchema = z
  .strictObject({
    streamKey: StreamKeySchema,
    streamId: StreamIdSchema,
    inputFormat: z.literal("vrcdn_fmp4"),
    packagingVersion: z.literal(1),
  })
  .refine((value) => value.streamKey === `vrcdn/${value.streamId}/1`);
export type SourceDescriptor = z.infer<typeof SourceDescriptorSchema>;
export function parseSourceDescriptor(input: unknown): SourceDescriptor {
  return SourceDescriptorSchema.parse(input);
}

/** Trusted identity normalization only. Admission always parses a URL-free descriptor. */
export function streamKeyFor(streamId: string): StreamKey {
  let id = streamId;
  if (id.startsWith("vrcdn:")) id = id.slice(6);
  else if (id.startsWith("https://")) {
    const match =
      /^https:\/\/stream\.vrcdn\.live\/live\/([A-Za-z0-9_-]+)\.live\.(?:mp4|ts)$/.exec(
        id,
      );
    id = match?.[1] ?? "";
  }
  return StreamKeySchema.parse(`vrcdn/${StreamIdSchema.parse(id)}/1`);
}
export const DjMetadataSchema = z.strictObject({
  displayName: z.string().min(1).max(256),
  artworkAssetId: opaqueId.nullable(),
  artworkRevision: opaqueId.nullable(),
});
export type DjMetadata = z.infer<typeof DjMetadataSchema>;
export const PlaybackGrantSchema = z
  .strictObject({
    id: opaqueId,
    streamKey: StreamKeySchema,
    context: PublicContextSchema,
    contextRevision: integer,
    issuedAt: measurement,
    expiresAt: measurement,
    renditions: z.tuple([z.literal("video"), z.literal("audio")]),
  })
  .refine((grant) => grant.expiresAt > grant.issuedAt);
export type PlaybackGrant = z.infer<typeof PlaybackGrantSchema>;
const playlist = z.string().min(1).max(4096);
export const AdmissionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("preparing"),
    grantId: opaqueId,
    retryAfterMs: positiveInteger,
  }),
  z.strictObject({
    kind: z.literal("ready"),
    grant: PlaybackGrantSchema,
    videoPlaylist: playlist,
    audioPlaylist: playlist,
    metadata: DjMetadataSchema,
  }),
  z.strictObject({
    kind: z.literal("unavailable"),
    reason: z.string().min(1).max(256),
  }),
  z.strictObject({
    kind: z.literal("capacityLimited"),
    retryAfterMs: positiveInteger,
  }),
]);
export type Admission = z.infer<typeof AdmissionSchema>;
export const OwnershipLeaseSchema = z
  .strictObject({
    streamKey: StreamKeySchema,
    workerId: opaqueId,
    epoch: positiveInteger,
    serverNow: measurement,
    expiresAt: measurement,
    renewAfterMs: positiveInteger,
  })
  .refine((lease) => lease.expiresAt > lease.serverNow);
export type OwnershipLease = z.infer<typeof OwnershipLeaseSchema>;
export const SegmentSchema = z.strictObject({
  sequence: integer,
  objectKey: z.string().min(1).max(1024),
  durationSeconds: measurement.positive(),
  programDateTime: measurement,
  discontinuity: z.boolean(),
});
export type Segment = z.infer<typeof SegmentSchema>;
export const RenditionSnapshotSchema = z.strictObject({
  streamKey: StreamKeySchema,
  epoch: positiveInteger,
  rendition: PlaybackModeSchema,
  targetDurationSeconds: measurement.positive(),
  sequence: integer,
  discontinuitySequence: integer,
  generatedAt: measurement,
  segments: z.array(SegmentSchema),
});
export type RenditionSnapshot = z.infer<typeof RenditionSnapshotSchema>;
export const WorkerAllocationSchema = z.strictObject({
  cpuUnits: positiveInteger,
  memoryMiB: positiveInteger,
  evidenceId: z.string().regex(/^[-a-zA-Z0-9_.:]{8,128}$/),
});
export const ResourceSnapshotSchema = z.strictObject({
  sampleSequence: integer,
  windowMs: measurement,
  sampleAgeMs: measurement,
  cpuUsagePercent: measurement.optional(),
  memoryUsedBytes: integer.optional(),
});
export const SourceStateSchema = z.enum([
  "queued",
  "starting",
  "ready",
  "recovering",
  "draining",
  "stopped",
  "unavailable",
]);
export const WorkerObservationSchema = z.strictObject({
  workerId: opaqueId,
  workerEpoch: positiveInteger,
  observedAt: measurement,
  allocation: WorkerAllocationSchema,
  activeJobs: integer,
  resources: ResourceSnapshotSchema.nullable(),
  jobs: z.array(
    z.strictObject({
      streamKey: StreamKeySchema,
      sourceEpoch: positiveInteger,
      state: SourceStateSchema,
      progressAt: measurement,
    }),
  ),
});
export type WorkerObservation = z.infer<typeof WorkerObservationSchema>;

export type WorkerAllocation = z.infer<typeof WorkerAllocationSchema>;
export type ResourceSnapshot = z.infer<typeof ResourceSnapshotSchema>;
export type SourceState = z.infer<typeof SourceStateSchema>;
