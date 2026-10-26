"use client";

import Link, { type LinkProps } from "next/link";
import { useFeatureFlagEnabled, usePostHog } from "posthog-js/react";
import { type ReactNode } from "react";

import {
  type DiscoveryAnalyticsSurface,
  type ProductAnalyticsEvent,
} from "@/lib/posthog";

type TrackedDiscoveryEvent = Extract<
  ProductAnalyticsEvent,
  "discovery_filter_selected" | "event_card_clicked" | "featured_card_clicked" | "search_result_clicked"
>;

type TrackedDiscoveryProperties = {
  discovery_filter_selected: { scope: string; surface: "home_terms" };
  event_card_clicked: { entity_type: "event"; surface: DiscoveryAnalyticsSurface };
  featured_card_clicked: { entity_type: string; surface: "featured" };
  search_result_clicked: { entity_type: string; profile_type?: string; surface: DiscoveryAnalyticsSurface };
};

export function DiscoveryFeatureGate({
  children,
  flag,
}: {
  children: ReactNode;
  flag: string;
}) {
  const enabled = useFeatureFlagEnabled(flag);

  return enabled === true ? children : null;
}

export { PublicSearchControl as DiscoverySearchForm } from "./public-search-control";

export function TrackedDiscoveryLink<Event extends TrackedDiscoveryEvent>({
  children,
  eventName,
  properties,
  ...props
}: LinkProps & {
  children: ReactNode;
  className?: string;
  eventName: Event;
  properties: TrackedDiscoveryProperties[Event];
}) {
  const posthog = usePostHog();

  return (
    <Link
      {...props}
      onClick={() => {
        posthog?.capture(eventName, properties);
      }}
    >
      {children}
    </Link>
  );
}
