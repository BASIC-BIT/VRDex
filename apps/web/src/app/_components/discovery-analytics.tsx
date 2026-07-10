"use client";

import Link, { type LinkProps } from "next/link";
import { usePostHog } from "posthog-js/react";
import { type FormEvent, type ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  captureProductEvent,
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

export function DiscoverySearchForm({
  action = "/search",
  className,
  defaultQuery,
  surface = "search",
  tone = "inverse",
}: {
  action?: string;
  className?: string;
  defaultQuery?: string;
  surface?: "home" | "search";
  tone?: "default" | "inverse";
}) {
  const posthog = usePostHog();
  const isInverse = tone === "inverse";

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const query = String(formData.get("q") ?? "").trim();

    if (query) {
      captureProductEvent(posthog, "search_submitted", { surface });
    }
  }

  return (
    <form className={cn("flex flex-col gap-3 sm:flex-row", className)} action={action} onSubmit={onSubmit}>
      <input
        className={cn(
          "min-h-14 flex-1 rounded-control border px-5 text-base outline-none focus-visible:ring-2",
          isInverse
            ? "border-white/25 bg-white/16 text-white placeholder:text-white/62 focus:border-white/70 focus-visible:ring-white/25"
            : "border-border bg-surface text-foreground placeholder:text-muted focus:border-accent focus-visible:ring-accent/20",
        )}
        defaultValue={defaultQuery}
        name="q"
        placeholder="Search DJs, communities, worlds, events, genres..."
      />
      <button
        className={cn(
          buttonVariants({ size: "lg", variant: isInverse ? "inversePrimary" : "primary" }),
          "min-h-14 px-6 font-semibold",
        )}
        type="submit"
      >
        Search VRDex
      </button>
    </form>
  );
}

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
        captureProductEvent(posthog, eventName, properties);
      }}
    >
      {children}
    </Link>
  );
}
