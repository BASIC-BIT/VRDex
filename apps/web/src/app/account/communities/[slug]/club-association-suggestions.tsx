"use client";

import { useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "@convex-generated-api";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { metricTime } from "./club-chart";
import { useClubWorkspace } from "./club-workspace";

export function ClubAssociationSuggestions({
  onSelectInstance,
}: {
  onSelectInstance: (sessionId: string) => void;
}) {
  const workspace = useClubWorkspace();
  const allowed = workspace.readableCategories.includes("event_recaps") &&
    (workspace.actor.kind === "owner" || workspace.actor.permissions.includes("manage_events"));
  const canReadInstances = workspace.readableCategories.includes("instance_history");
  const suggestions = usePaginatedQuery(
    api.clubAnalytics.listAssociationSuggestions,
    allowed ? { communitySlug: workspace.community.slug } : "skip",
    { initialNumItems: 10 },
  );
  const review = useMutation(api.communityTelemetry.reviewAssociationSuggestion);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (!allowed || (suggestions.status !== "LoadingFirstPage" && suggestions.results.length === 0 && !message))
    return null;
  return (
    <Card padding="lg" className="min-w-0">
      <SectionTitle>Event associations</SectionTitle>
      {suggestions.results.map((suggestion) => (
        <div key={suggestion.id} className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="min-w-0 text-sm">
            <p className="font-medium">{suggestion.eventTitle ?? "Event"}</p>
            <p className="mt-1 text-muted">
              Suggested match · {Math.round(suggestion.confidence * 100)}% confidence
            </p>
            {suggestion.sessionId && canReadInstances ? (
              <Button size="sm" variant="ghost" className="mt-1" onClick={() => onSelectInstance(suggestion.sessionId!)}>
                {suggestion.worldName ?? "Instance detail"}
                {suggestion.openedAt ? ` · ${metricTime(suggestion.openedAt)}` : ""}
              </Button>
            ) : suggestion.sessionId ? (
              <p className="mt-1 text-muted">
                {suggestion.worldName ?? "Instance detail"}
                {suggestion.openedAt ? ` · ${metricTime(suggestion.openedAt)}` : ""}
              </p>
            ) : <p className="mt-1 text-muted">Instance unavailable.</p>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={!suggestion.canConfirm || busyId !== null} onClick={async () => {
              setBusyId(suggestion.id);
              setMessage(null);
              try {
                await review({ communitySlug: workspace.community.slug, associationId: suggestion.id, state: "confirmed" });
                setMessage("Suggestion confirmed.");
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Association failed.");
              } finally {
                setBusyId(null);
              }
            }}>Confirm</Button>
            <Button size="sm" variant="secondary" disabled={busyId !== null} onClick={async () => {
              setBusyId(suggestion.id);
              setMessage(null);
              try {
                await review({ communitySlug: workspace.community.slug, associationId: suggestion.id, state: "rejected" });
                setMessage("Suggestion rejected.");
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Association failed.");
              } finally {
                setBusyId(null);
              }
            }}>Reject</Button>
          </div>
        </div>
      ))}
      {suggestions.status === "LoadingFirstPage" ? <Notice role="status" className="mt-4">Loading…</Notice> : null}
      {suggestions.status === "CanLoadMore" ? (
        <Button className="mt-4" disabled={busyId !== null} onClick={() => suggestions.loadMore(10)}>Load more</Button>
      ) : null}
      {message ? <Notice role="status" className="mt-4">{message}</Notice> : null}
    </Card>
  );
}
