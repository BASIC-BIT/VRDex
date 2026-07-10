"use client";

import posthog from "posthog-js";
import { PostHogProvider as Provider } from "posthog-js/react";
import { useEffect, type ReactNode } from "react";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com";
const urlPropertyNames = new Set(["$current_url", "$referrer", "$initial_referrer"]);

function sanitizePostHogProperties(properties: Record<string, unknown>) {
  for (const propertyName of urlPropertyNames) {
    const value = properties[propertyName];

    if (typeof value === "string") {
      properties[propertyName] = value.split(/[?#]/, 1)[0];
    }
  }

  return properties;
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (!posthogKey || (posthog as { __loaded?: boolean }).__loaded) {
      return;
    }

    posthog.init(posthogKey, {
      api_host: posthogHost,
      capture_pageview: true,
      capture_pageleave: true,
      defaults: "2025-05-24",
      disable_session_recording: true,
      sanitize_properties: sanitizePostHogProperties,
      session_recording: {
        blockSelector: "[data-ph-no-capture]",
        maskAllInputs: true,
        maskTextSelector: "[data-ph-no-capture]",
      },
      loaded: (client) => {
        if (process.env.NODE_ENV !== "production") {
          client.opt_out_capturing();
        }
      },
    });
  }, []);

  return <Provider client={posthog}>{children}</Provider>;
}
