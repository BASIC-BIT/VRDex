"use client";

import posthog from "posthog-js";
import { PostHogProvider as Provider } from "posthog-js/react";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import {
  isSessionReplayAllowedPathname,
  sanitizePostHogProperties,
} from "@/lib/posthog";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();

export function PostHogProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(
    () => Boolean((posthog as { __loaded?: boolean }).__loaded),
  );

  useEffect(() => {
    if (!posthogKey || (posthog as { __loaded?: boolean }).__loaded) {
      return;
    }

    posthog.init(posthogKey, {
      api_host: "/ingest",
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
        setReady(true);
      },
    });
  }, []);

  useEffect(() => {
    if (!ready || process.env.NODE_ENV !== "production") {
      return;
    }

    if (isSessionReplayAllowedPathname(pathname)) {
      posthog.startSessionRecording();
    } else {
      posthog.stopSessionRecording();
    }
  }, [pathname, ready]);

  return <Provider client={posthog}>{children}</Provider>;
}
