import type { PlanReference } from "../../../../../convex/_eventTimelineTypes";
import type { PreferenceAction } from "./preferences";
export function planSaveState(
  plan: ReadonlyArray<PlanReference>,
  reference: PlanReference,
): "unsaved" | "saved" | "included" {
  if (
    reference.kind === "set" &&
    plan.some((p) => p.kind === "event" && p.eventId === reference.eventId)
  )
    return "included";
  return plan.some(
    (p) =>
      p.eventId === reference.eventId &&
      (p.kind === "event" ||
        (reference.kind === "set" && p.slotId === reference.slotId)),
  )
    ? "saved"
    : "unsaved";
}
export function togglePlanAction(
  plan: ReadonlyArray<PlanReference>,
  reference: PlanReference,
): Extract<PreferenceAction, { type: "add-plan" | "remove-plan" }> | null {
  const state = planSaveState(plan, reference);
  if (state === "included") return null;
  return state === "unsaved"
    ? { type: "add-plan", reference }
    : { type: "remove-plan", reference };
}
