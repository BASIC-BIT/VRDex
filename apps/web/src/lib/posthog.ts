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

const RRWEB_META_EVENT_TYPE = 4;
const RRWEB_CUSTOM_EVENT_TYPE = 5;

/**
 * Rewrite the page URLs a replay recording carries alongside the DOM.
 *
 * Session replay ships rrweb records inside `$snapshot_data`, and two of them
 * hold a raw page URL of their own: the meta record (`type: 4`), which is what
 * the replay player shows as the recording's address, and the recorder's
 * `$url_changed` custom record (`type: 5`), which it emits on SPA navigation
 * when `capture_pageview` is off. Redacting the event-level URL properties
 * touches neither, so with replay on every route a handoff token in the path
 * would still reach PostHog even though the page DOM is blocked from capture.
 *
 * Deliberately not every `href` in the payload. The DOM snapshot is full of
 * them — stylesheet links, `<use href="#id">`, `data:` favicons — and
 * `sanitizeAnalyticsUrl` is built for page URLs: it drops the query and
 * fragment, which would rewrite a query-keyed stylesheet into one the replay
 * player cannot fetch.
 */
function sanitizeSnapshotData(value: unknown): unknown {
  // `posthog-js` sends one rrweb record per `$snapshot` event, and batches into
  // an array only when it flushes several at once. Handling the array alone
  // meant the single-record form — the normal one — passed straight through,
  // so this sanitizer did nothing in a real browser.
  if (Array.isArray(value)) {
    return value.map(sanitizeSnapshotRecord);
  }

  return sanitizeSnapshotRecord(value);
}

function sanitizeSnapshotRecord(record: unknown): unknown {
  if (record === null || typeof record !== "object") {
    return record;
  }

  const { type, data } = record as { type?: unknown; data?: unknown };

  if (data === null || typeof data !== "object") {
    return record;
  }

  if (type === RRWEB_META_EVENT_TYPE) {
    const href = (data as { href?: unknown }).href;

    return typeof href === "string"
      ? { ...record, data: { ...data, href: sanitizeAnalyticsUrl(href) } }
      : record;
  }

  if (type === RRWEB_CUSTOM_EVENT_TYPE) {
    const payload = (data as { payload?: unknown }).payload;

    if (payload === null || typeof payload !== "object") {
      return record;
    }

    const href = (payload as { href?: unknown }).href;

    return typeof href === "string"
      ? {
          ...record,
          data: { ...data, payload: { ...payload, href: sanitizeAnalyticsUrl(href) } },
        }
      : record;
  }

  return record;
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

  // Person properties live *inside* `properties` at runtime, not at the event
  // root. Reading them from the root left `$initial_current_url` untouched, so
  // the first view of `/handoff/<token>` pinned the live bearer token to the
  // person record as a persistent property — the one place redaction matters
  // most, since it outlives the event.
  //
  // The root is still swept: posthog-js has carried these at both levels across
  // versions, and sanitizing an absent bucket costs nothing.
  for (const container of [event, event.properties] as const) {
    if (container === undefined) {
      continue;
    }

    for (const bucket of ["$set", "$set_once"] as const) {
      const values = container[bucket];

      if (values !== undefined && typeof values === "object" && values !== null) {
        container[bucket] = sanitizePostHogProperties(values as Record<string, unknown>);
      }
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
export const SESSION_REPLAY_MASKED_SELECTOR = [
  "[data-ph-no-capture]",
  // Clerk renders its profile and auth surfaces into a body-level portal, so
  // they sit outside every `data-ph-no-capture` wrapper in the app tree. That
  // modal shows the account email, linked identities, and signed-in device
  // details — exactly the material the marked regions exist to keep out of
  // replays — and the markup is provider-controlled, so it cannot be annotated
  // from here. Masked by selector instead.
  ".cl-modalContent",
  ".cl-userProfile-root",
  ".cl-userButtonPopoverCard",
  ".cl-card",
].join(", ");

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
  auth_session_restore_completed: {
    browser_family?: "chromium" | "firefox" | "other" | "safari";
    deployment_category?: "development" | "preview" | "production" | "staging";
    latency_bucket: "over_10s" | "under_10s" | "under_1s" | "under_3s";
    os_family?: "android" | "ios" | "linux" | "macos" | "other" | "windows";
    outcome: "anonymous" | "authenticated";
    route_class: "auth" | "protected" | "public";
  };
  auth_session_restore_slow: {
    browser_family?: "chromium" | "firefox" | "other" | "safari";
    deployment_category?: "development" | "preview" | "production" | "staging";
    os_family?: "android" | "ios" | "linux" | "macos" | "other" | "windows";
    route_class: "auth" | "protected" | "public";
  };
  auth_session_signout_requested: Record<string, never>;
  auth_session_state_changed: {
    browser_family?: "chromium" | "firefox" | "other" | "safari";
    deployment_category?: "development" | "preview" | "production" | "staging";
    from: "anonymous" | "authenticated";
    intent: "explicit_signout_current_tab" | "unclassified";
    os_family?: "android" | "ios" | "linux" | "macos" | "other" | "windows";
    to: "anonymous" | "authenticated";
  };
  recent_auth_challenge_completed: {
    $insert_id?: string;
    action_class:
      | "developer_oauth_application"
      | "developer_token"
      | "session_revocation";
    outcome: "cancelled" | "completed";
  };
  recent_auth_challenge_presented: {
    action_class:
      | "developer_oauth_application"
      | "developer_token"
      | "session_revocation";
  };
  sensitive_action_denied: {
    action_class:
      | "developer_oauth_application"
      | "developer_token"
      | "session_revocation";
    reason: "stale";
  };
  session_revocation_completed: {
    scope: "all" | "one" | "others";
  };
  session_revocation_started: {
    scope: "all" | "others";
  };
  session_revocation_detected: Record<string, never>;
  session_revocation_requested: {
    scope: "all" | "one" | "others";
  };
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
