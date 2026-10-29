import { z } from "zod";
const positive = z.number().finite().positive();
// Installed by deployment administrators after review, never supplied by a viewer/worker.
export const ReleaseEvidenceSchema = z
  .strictObject({
    target: z.literal("hosted"),
    evidenceId: z.string().regex(/^[-a-zA-Z0-9_.:]{8,128}$/),
    measuredAt: z.number().int().positive(),
    deployment: z.string().min(8),
    sourceCap: positive.int(),
    cpuPeakPercent: positive.max(70),
    memoryPeakBytes: positive,
    diskPeakBytes: positive,
    partialDiskPeakBytes: positive,
    diskLimitBytes: positive,
    partialDiskBoundVerified: z.literal(true),
    queuePeak: positive.int(),
    upstreamBytes: positive,
    videoBytes: positive,
    audioBytes: positive,
    coldStartupMs: positive,
    warmStartupMs: positive,
    reconnectMs: positive.max(30000),
    remoteOperations: positive.int(),
    cleanupPassed: z.literal(true),
    timestampWarnings: z.literal(0),
    // PAYG acceptance is explicitly a risk decision, never a claim of a hard traffic cap.
    trafficDecision: z.literal("owner-accepted-payg-exposure"),
    ownerApprovalReference: z.string().min(8),
    monthlyBudgetUsd: positive,
  })
  .refine(
    (e) =>
      e.diskPeakBytes < e.diskLimitBytes &&
      e.partialDiskPeakBytes <= e.diskPeakBytes,
    "Disk evidence exceeds limit",
  );
