import type { PostHog } from "posthog-js";

export const PRIVATE_SEED_LOOKUP_UI_FLAG = "seed-lookup-beta";
export const FEATURED_DISCOVERY_UI_FLAG = "featured-discovery";
export const TEMPORAL_PARSING_UI_FLAG = "temporal-parsing-beta";
const URL_PROPERTY_NAMES = new Set([
  "$current_url",
  "$pathname",
  "$referrer",
  "$initial_referrer",
  // `save_campaign_params`/`save_referrer` default on, so posthog-js records
  // the first page a person ever landed on as a `$set_once` person property.
  // For someone whose first VRDex page is their handoff link — which is how
  // recipients discover the product — that stored value is the live token.
  "$initial_current_url",
  "$initial_pathname",
]);

export function sanitizeAnalyticsUrl(value: string): string {
  const fallback = value.split(/[?#]/, 1)[0];

  try {
    const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
    const url = new URL(value, "https://vrdex.invalid");
    const pathname = url.pathname
      .replace(/^\/handoff\/[^/]+/, "/handoff/redacted")
      .replace(/^\/claim\/[^/]+/, "/claim/redacted");

    return absolute ? `${url.protocol}//${url.host}${pathname}` : pathname;
  } catch {
    return fallback
      .replace(/^\/handoff\/[^/]+/, "/handoff/redacted")
      .replace(/^\/claim\/[^/]+/, "/claim/redacted");
  }
}

/**
 * Rewrite the `href` a replay recording carries alongside the DOM.
 *
 * Session replay ships rrweb records inside `$snapshot_data`, and the meta
 * record (`type: 4`) holds the raw page URL — that is what the replay player
 * shows as the recording's address. Redacting the event-level URL properties
 * does not touch it, so with replay enabled on every route a handoff token in
 * the path would still reach PostHog even though the page DOM is blocked from
 * capture. Anything with an `href` gets the same treatment as `$current_url`.
 */
const RRWEB_META_EVENT_TYPE = 4;

function sanitizeSnapshotData(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  // Only the meta record's own `href`, not every `href` in the payload. The DOM
  // snapshot is full of them — stylesheet links, `<use href="#id">`, `data:`
  // favicons — and `sanitizeAnalyticsUrl` is built for page URLs: it drops the
  // query and fragment, which would silently rewrite a query-keyed stylesheet
  // into one the replay player cannot fetch.
  return value.map((record) => {
    if (
      record === null ||
      typeof record !== "object" ||
      (record as { type?: unknown }).type !== RRWEB_META_EVENT_TYPE
    ) {
      return record;
    }

    const data = (record as { data?: unknown }).data;

    if (data === null || typeof data !== "object") {
      return record;
    }

    const href = (data as { href?: unknown }).href;

    return typeof href === "string"
      ? { ...record, data: { ...data, href: sanitizeAnalyticsUrl(href) } }
      : record;
  });
}

export function sanitizePostHogProperties(properties: Record<string, unknown>) {
  const sanitized = { ...properties };

  for (const propertyName of URL_PROPERTY_NAMES) {
    const value = sanitized[propertyName];
    if (typeof value === "string") {
      sanitized[propertyName] = sanitizeAnalyticsUrl(value);
    }
  }

  if (sanitized.$snapshot_data !== undefined) {
    sanitized.$snapshot_data = sanitizeSnapshotData(sanitized.$snapshot_data);
  }

  return sanitized;
}

type CapturedEvent = {
  properties?: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
} | null;

/**
 * Redaction hook for every outgoing event.
 *
 * This must be `before_send`, not `sanitize_properties`. posthog-js
 * short-circuits `$snapshot` events before the `sanitize_properties` hook runs,
 * so session-replay payloads were never passed through it — and replay is the
 * one thing that carries a raw page URL of its own, in the rrweb meta record.
 * `sanitize_properties` is also deprecated in favour of this hook.
 */
export function sanitizePostHogEvent<T extends CapturedEvent>(event: T): T {
  if (event === null) {
    return event;
  }

  if (event.properties !== undefined) {
    event.properties = sanitizePostHogProperties(event.properties);
  }

  for (const bucket of ["$set", "$set_once"] as const) {
    const values = event[bucket];

    if (values !== undefined) {
      event[bucket] = sanitizePostHogProperties(values);
    }
  }

  return event;
}

/**
 * Session replay runs on every route by product decision (2026-07-27),
 * superseding the earlier public-routes-only allowlist.
 *
 * Replay stays safe through masking rather than route exclusion:
 * `maskAllInputs` redacts every input value (passwords, OTP codes, VRChat and
 * Discord identifiers typed into claim forms), and regions marked
 * `data-ph-no-capture` — notably the whole claim journey section — are blocked
 * from capture entirely. URL properties are still sanitized by
 * `sanitizeAnalyticsUrl`, so handoff tokens and claim slugs never reach
 * PostHog. Removing either protection would leak credentials into replays.
 */
export const SESSION_REPLAY_MASKED_SELECTOR = "[data-ph-no-capture]";

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
  claim_journey_viewed: {
    profile_type: "person" | "community";
    source: "account" | "profile" | "search";
  };
  claim_method_selected: {
    method: "discord" | "vrchat";
    profile_type: "person" | "community";
  };
  claim_submitted: {
    method: "discord" | "vrchat";
    profile_type: "person" | "community";
  };
  claim_completed: {
    method: "discord" | "vrchat";
    outcome: "already_owned" | "claimed_unverified" | "claimed_verified";
    profile_type: "person" | "community";
  };
  claim_failed: {
    method: "discord" | "vrchat";
    outcome: "conflict" | "expired" | "not_verified" | "unavailable" | "unknown";
    profile_type: "person" | "community";
  };
  search_submitted: { surface: "home" | "search"; view_key: "standard" };
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
    view_key: "dj";
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
