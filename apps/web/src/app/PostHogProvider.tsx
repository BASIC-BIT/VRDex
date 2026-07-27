"use client";

import posthog from "posthog-js";
import { PostHogProvider as Provider } from "posthog-js/react";
import { type ReactNode, useEffect } from "react";

import {
  SESSION_REPLAY_MASKED_SELECTOR,
  sanitizePostHogProperties,
} from "@/lib/posthog";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (!posthogKey || (posthog as { __loaded?: boolean }).__loaded) {
      return;
    }

    posthog.init(posthogKey, {
      api_host: "/ingest",
      capture_pageview: true,
      capture_pageleave: true,
      defaults: "2025-05-24",
      sanitize_properties: sanitizePostHogProperties,
      // Replay records every route; masking, not route exclusion, is what
      // keeps credentials and proof codes out of recordings. See
      // `SESSION_REPLAY_MASKED_SELECTOR` for the full rationale.
      session_recording: {
        blockSelector: SESSION_REPLAY_MASKED_SELECTOR,
        maskAllInputs: true,
        maskTextSelector: SESSION_REPLAY_MASKED_SELECTOR,
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
