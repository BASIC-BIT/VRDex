import type { PostHog } from "posthog-js";

export const PRIVATE_SEED_LOOKUP_UI_FLAG = "seed-lookup-beta";
export const FEATURED_DISCOVERY_UI_FLAG = "featured-discovery";
export const TEMPORAL_PARSING_UI_FLAG = "temporal-parsing-beta";
const URL_PROPERTY_NAMES = new Set([
  "$current_url",
  "$pathname",
  "$referrer",
  "$initial_referrer",
]);

export function sanitizeAnalyticsUrl(value: string): string {
  const fallback = value.split(/[?#]/, 1)[0];

  try {
    const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
    const url = new URL(value, "https://vrdex.invalid");
    const pathname = url.pathname.replace(/^\/handoff\/[^/]+/, "/handoff/redacted");

    return absolute ? `${url.protocol}//${url.host}${pathname}` : pathname;
  } catch {
    return fallback.replace(/^\/handoff\/[^/]+/, "/handoff/redacted");
  }
}

export function sanitizePostHogProperties(properties: Record<string, unknown>) {
  const sanitized = { ...properties };

  for (const propertyName of URL_PROPERTY_NAMES) {
    const value = sanitized[propertyName];
    if (typeof value === "string") {
      sanitized[propertyName] = sanitizeAnalyticsUrl(value);
    }
  }

  return sanitized;
}

export function isSessionReplayAllowedPathname(pathname: string): boolean {
  return pathname === "/" ||
    pathname === "/search" ||
    pathname === "/discover" ||
    pathname === "/discovery" ||
    pathname === "/upcoming" ||
    pathname.startsWith("/p/") ||
    pathname.startsWith("/c/") ||
    pathname.startsWith("/e/") ||
    pathname.startsWith("/worlds/");
}

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
    ui_flag: "enabled" | "super_admin_bypass";
  };
  temporal_page_opened: { retention_default: "retain" | "do_not_retain" };
  temporal_parse_submitted: { retention: "retain" | "do_not_retain" };
  temporal_parse_completed: {
    latency: "under_2s" | "under_5s" | "under_30s" | "over_30s";
    outcome: "resolved" | "needs_clarification" | "no_plan" | "failed";
  };
  temporal_retention_changed: { retention_default: "retain" | "do_not_retain" };
};

export type ProductAnalyticsEvent = keyof ProductAnalyticsEvents;

export function captureProductEvent<Event extends ProductAnalyticsEvent>(
  posthog: PostHog | undefined,
  event: Event,
  properties: ProductAnalyticsEvents[Event],
) {
  posthog?.capture(event, properties);
}

export function mirrorTemporalParsingAccess(
  posthog: PostHog | undefined,
  canUseTemporalParsing: boolean,
) {
  const properties = {
    temporal_parsing_beta: canUseTemporalParsing ? "true" : "false",
  };

  posthog?.setPersonProperties(properties);
  posthog?.setPersonPropertiesForFlags(properties, true);
}

export function mirrorPrivateSeedLookupAccess(
  posthog: PostHog | undefined,
  canViewPrivateSeedLookup: boolean,
) {
  const properties = {
    seed_lookup_beta: canViewPrivateSeedLookup ? "true" : "false",
  };

  posthog?.setPersonProperties(properties);
  posthog?.setPersonPropertiesForFlags(properties, true);
}
