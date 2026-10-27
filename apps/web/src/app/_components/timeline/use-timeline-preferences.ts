"use client";

import { useSyncExternalStore } from "react";
import type { PlanReference } from "../../../../../../convex/_eventTimelineTypes";
import { createPreferenceStore } from "../../../lib/timeline/preference-storage";

// Providers run when the first subscriber commits. Rendering never touches storage.
const store = createPreferenceStore({
  storage: () => typeof window === "undefined" ? null : window.localStorage,
  eventTarget: () => typeof window === "undefined" ? null : window,
});
const actions = {
  addPlan: (reference: PlanReference) => store.dispatch({ type: "add-plan", reference }),
  removePlan: (reference: PlanReference) => store.dispatch({ type: "remove-plan", reference }),
  addFavorite: (profileId: string) => store.dispatch({ type: "add-favorite", profileId }),
  removeFavorite: (profileId: string) => store.dispatch({ type: "remove-favorite", profileId }),
};

export function useTimelinePreferences() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return { ...snapshot, ...actions };
}
