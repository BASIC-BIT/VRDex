import type { PlanReference } from "../../../../../convex/_eventTimelineTypes";

export type TimelinePreferences = { version: 1; plan: PlanReference[]; favoriteProfileIds: string[] };
export type PreferenceAction =
  | { type: "add-plan"; reference: PlanReference }
  | { type: "remove-plan"; reference: PlanReference }
  | { type: "add-favorite"; profileId: string }
  | { type: "remove-favorite"; profileId: string };
export type PreferenceResult = { state: TimelinePreferences; outcome: "changed" | "unchanged" | "limit" };

function sameReference(left: PlanReference, right: PlanReference): boolean {
  return left.eventId === right.eventId && left.kind === right.kind &&
    (left.kind === "event" || (right.kind === "set" && left.slotId === right.slotId));
}

export function reducePreferences(state: TimelinePreferences, action: PreferenceAction): PreferenceResult {
  switch (action.type) {
    case "add-plan": {
      const reference = action.reference;
      if (state.plan.some((saved) => sameReference(saved, reference) ||
        (saved.kind === "event" && saved.eventId === reference.eventId))) {
        return { state, outcome: "unchanged" };
      }
      const plan = reference.kind === "event"
        ? state.plan.filter((saved) => saved.eventId !== reference.eventId)
        : state.plan;
      if (plan.length >= 200) return { state, outcome: "limit" };
      const stored: PlanReference = reference.kind === "event"
        ? { kind: "event", eventId: reference.eventId }
        : { kind: "set", eventId: reference.eventId, slotId: reference.slotId };
      return { state: { ...state, plan: [...plan, stored] }, outcome: "changed" };
    }
    case "remove-plan": {
      const plan = state.plan.filter((saved) => !sameReference(saved, action.reference));
      return plan.length === state.plan.length
        ? { state, outcome: "unchanged" }
        : { state: { ...state, plan }, outcome: "changed" };
    }
    case "add-favorite":
      if (state.favoriteProfileIds.includes(action.profileId)) return { state, outcome: "unchanged" };
      if (state.favoriteProfileIds.length >= 500) return { state, outcome: "limit" };
      return { state: { ...state, favoriteProfileIds: [...state.favoriteProfileIds, action.profileId] }, outcome: "changed" };
    case "remove-favorite": {
      const favoriteProfileIds = state.favoriteProfileIds.filter((id) => id !== action.profileId);
      return favoriteProfileIds.length === state.favoriteProfileIds.length
        ? { state, outcome: "unchanged" }
        : { state: { ...state, favoriteProfileIds }, outcome: "changed" };
    }
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
