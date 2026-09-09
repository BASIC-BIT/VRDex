"use client";

import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex-generated-api";

/** A visit requests work once; the backend owns freshness, cooldowns and deduplication. */
export function ProfileLinkRefresh({ slug }: { slug: string }) {
  const request = useMutation(api.profileLinkDestinations.requestForProfile);
  const requestedSlug = useRef<string | null>(null);

  useEffect(() => {
    if (requestedSlug.current === slug) return;
    requestedSlug.current = slug;
    // A failed request is retried on a later visit, never by a browser timer.
    void request({ slug }).catch(() => undefined);
  }, [request, slug]);

  return null;
}
