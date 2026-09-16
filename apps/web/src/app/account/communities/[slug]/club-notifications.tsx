"use client";
import { useMutation, usePaginatedQuery } from "convex/react";
import { useState } from "react";
import Link from "next/link";
import { api } from "@convex-generated-api";
import { Button } from "@/components/ui/button";
import { useClubWorkspace } from "./club-workspace";
import {
  operationLabels,
  type ClubOperationPayload,
} from "./club-operation-model";

export function ClubNotifications() {
  const workspace = useClubWorkspace();
  const {
    results: notifications,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.clubNotifications.list,
    {
      communityProfileId: workspace.community._id,
    },
    { initialNumItems: 20 },
  );
  const markRead = useMutation(api.clubNotifications.markRead);
  const [error, setError] = useState(false);
  if (
    !notifications.some((item) => !item.read) &&
    (status === "Exhausted" || status === "LoadingFirstPage")
  )
    return null;
  return (
    <section aria-label="Action notifications" className="space-y-3">
      <h2 className="text-lg font-semibold">Needs attention</h2>
      {error ? <p role="alert">Could not dismiss notification.</p> : null}
      <ul className="divide-y divide-border">
        {notifications
          .filter((item) => !item.read)
          .map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div>
                <Link
                  className="font-medium underline underline-offset-4"
                  href={`/account/communities/${encodeURIComponent(workspace.community.slug)}/scheduled`}
                >
                  {Object.hasOwn(operationLabels, item.kind)
                    ? operationLabels[item.kind as ClubOperationPayload["kind"]]
                    : "Scheduled action"}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {item.outcome === "indeterminate"
                    ? "Outcome unknown"
                    : item.outcome === "missed"
                      ? "Missed"
                      : "Failed"}
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setError(false);
                  void markRead({ notificationId: item.id }).catch(() =>
                    setError(true),
                  );
                }}
              >
                Dismiss
              </Button>
            </li>
          ))}
      </ul>
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <Button
          variant="secondary"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(20)}
        >
          Load more notifications
        </Button>
      ) : null}
    </section>
  );
}
