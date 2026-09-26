"use client";
import { useMutation, usePaginatedQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@convex-generated-api";
import { Button } from "@/components/ui/button";
import { useClubWorkspace } from "./club-workspace";
import {
  operationLabels,
  type ClubOperationPayload,
} from "./club-operation-model";

const MAX_AUTO_EMPTY_PAGES = 5;

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
  const unread = notifications.filter((item) => !item.read);
  const autoPaging = useRef({
    communityId: workspace.community._id,
    lastResults: undefined as typeof notifications | undefined,
    pages: 0,
  });
  useEffect(() => {
    const paging = autoPaging.current;
    if (paging.communityId !== workspace.community._id) {
      paging.communityId = workspace.community._id;
      paging.lastResults = undefined;
      paging.pages = 0;
    }
    if (
      unread.length === 0 &&
      status === "CanLoadMore" &&
      paging.pages < MAX_AUTO_EMPTY_PAGES &&
      paging.lastResults !== notifications
    ) {
      paging.lastResults = notifications;
      paging.pages += 1;
      loadMore(20);
    }
  }, [loadMore, notifications, status, unread.length, workspace.community._id]);
  if (
    unread.length === 0 &&
    (status === "Exhausted" ||
      status === "LoadingFirstPage" ||
      status === "LoadingMore")
  )
    return null;
  return (
    <section aria-label="Action notifications" className="space-y-3">
      <h2 className="text-lg font-semibold">Needs attention</h2>
      {error ? <p role="alert">Could not dismiss notification.</p> : null}
      <ul className="divide-y divide-border">
        {unread.map((item) => (
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
