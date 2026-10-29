import { v } from "convex/values";

export const admissionDiagnosticsValidator = v.object({
  pending: v.number(), active: v.number(), paused: v.number(), ended: v.number(),
  cleanup_pending: v.number(), cancelled: v.number(), externalWaiting: v.number(),
  processingBacklog: v.number(), oldestProcessingAgeMs: v.number(),
});

export function emptyAdmissionDiagnostics() {
  return { pending: 0, active: 0, paused: 0, ended: 0, cleanup_pending: 0, cancelled: 0,
    externalWaiting: 0, processingBacklog: 0, oldestProcessingAgeMs: 0 };
}

export const ADMISSION_MONITORING_FRESHNESS_MS = 6 * 60_000;
