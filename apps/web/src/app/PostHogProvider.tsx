"use client";

import posthog from "posthog-js";
import { PostHogProvider as Provider } from "posthog-js/react";
import { useEffect, type ReactNode } from "react";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

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
      loaded: (client) => {
        if (process.env.NODE_ENV !== "production") {
          client.opt_out_capturing();
        }
      },
    });
  }, []);

  return <Provider client={posthog}>{children}</Provider>;
}
