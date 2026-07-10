import type { PostHog } from "posthog-js";

export const PRIVATE_SEED_LOOKUP_UI_FLAG = "seed-lookup-beta";

export type DiscoveryAnalyticsSurface =
  | "featured"
  | "home"
  | "home_terms"
  | "search"
  | "search_results"
  | "upcoming_events"
  | "active_worlds"
  | "featured_picks";

type ProductAnalyticsEvents = {
  search_submitted: { surface: "home" | "search" };
  search_result_clicked: {
    entity_type: string;
    profile_type?: string;
    surface: DiscoveryAnalyticsSurface;
  };
  discovery_filter_selected: { scope: string; surface: "home_terms" };
  event_card_clicked: { entity_type: "event"; surface: DiscoveryAnalyticsSurface };
  featured_card_clicked: { entity_type: string; surface: "featured" };
  lookup_submitted: {
    access_scope: "private_and_public" | "public_only";
    mode: "bulk" | "single";
  };
  private_seed_results_shown: {
    result_count: "multiple" | "one";
    ui_flag: "enabled" | "unavailable";
  };
};

export type ProductAnalyticsEvent = keyof ProductAnalyticsEvents;

export function captureProductEvent<Event extends ProductAnalyticsEvent>(
  posthog: PostHog | undefined,
  event: Event,
  properties: ProductAnalyticsEvents[Event],
) {
  posthog?.capture(event, properties);
}

export function mirrorPrivateSeedLookupAccess(
  posthog: PostHog | undefined,
  canViewPrivateSeedLookup: boolean,
) {
  posthog?.setPersonProperties({
    seed_lookup_beta: canViewPrivateSeedLookup ? "true" : "false",
  });
  posthog?.reloadFeatureFlags();
}
