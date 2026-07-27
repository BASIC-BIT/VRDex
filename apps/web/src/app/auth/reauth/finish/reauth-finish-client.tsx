"use client";

import { usePostHog } from "posthog-js/react";
import { useEffect, useRef } from "react";

import type { RecentAuthActionClass } from "@/lib/recent-auth";
import { reauthenticationFinishClearPath } from "@/lib/recent-auth";
import { captureProductEvent } from "@/lib/posthog";

export function ReauthFinishClient({
  actionClass,
  challengeId,
  returnTo,
}: {
  actionClass: RecentAuthActionClass;
  challengeId: string;
  returnTo: string;
}) {
  const emitted = useRef(false);
  const posthog = usePostHog();

  useEffect(() => {
    if (emitted.current) {
      return;
    }
    emitted.current = true;
    captureProductEvent(posthog, "recent_auth_challenge_completed", {
      $insert_id: `recent_auth_${challengeId}`,
      action_class: actionClass,
      outcome: "completed",
    });
    window.location.replace(
      reauthenticationFinishClearPath(returnTo, challengeId),
    );
  }, [actionClass, challengeId, posthog, returnTo]);

  return null;
}
