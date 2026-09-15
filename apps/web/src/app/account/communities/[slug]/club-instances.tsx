"use client";

import { useEffect, useMemo } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import {
  summarizeSeries,
  mergeSeriesSegments,
  type SeriesPoint,
} from "../../../../../../../convex/_clubAnalyticsMath";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import {
  ClubChart,
  metricNumber,
  metricTime,
  type ClubChartPoint,
} from "./club-chart";
import { useClubWorkspace } from "./club-workspace";
import { ClubEventAssociation } from "./club-event-association";
import { useClubRange } from "./club-range";
import {
  ClubInstanceActions,
  CloseInstanceAction,
} from "./club-instance-actions";

export type InstanceRow = {
  id: Id<"instanceSessions">;
  worldId: string;
  worldName: string | null;
  providerInstanceId: string;
  openedAt: number;
  closedAt: number | null;
  lastObservedAt: number;
  state: "open" | "closed";
};

export function observedChartPoints(points: SeriesPoint[]): ClubChartPoint[] {
  const result: ClubChartPoint[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (previous && point.at - previous.at > 5 * 60_000)
      result.push({
        at: previous.at + 1,
        value: null,
        label: new Date(previous.at + 1).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
    result.push({
      at: point.at,
      value: point.coverage === "observed" ? point.value : null,
      label: new Date(point.at).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      }),
    });
  }
  return result;
}

function useInstancePoints(communitySlug: string, session: InstanceRow) {
  const endAt = Math.max(
    session.openedAt + 1,
    session.closedAt ?? session.lastObservedAt + 1,
  );
  const query = usePaginatedQuery(
    api.clubAnalytics.getInstanceSeries,
    { communitySlug, sessionId: session.id, startAt: session.openedAt, endAt },
    { initialNumItems: 500 },
  );
  const { status, loadMore } = query;
  useEffect(() => {
    if (status === "CanLoadMore") loadMore(500);
  }, [status, loadMore]);
  const complete = query.status === "Exhausted";
  const summary = useMemo(
    () =>
      complete ? summarizeSeries(query.results, session.openedAt, endAt) : null,
    [complete, query.results, session.openedAt, endAt],
  );
  return { ...query, complete, summary };
}

function InstanceMetricsRow({
  session,
  communitySlug,
  onSelect,
}: {
  session: InstanceRow;
  communitySlug: string;
  onSelect: (id: string) => void;
}) {
  const endAt = Math.max(
    session.openedAt + 1,
    session.closedAt ?? session.lastObservedAt + 1,
  );
  const metrics = usePaginatedQuery(
    api.clubAnalytics.getInstanceSummaryPage,
    {
      communitySlug,
      sessionId: session.id,
      startAt: session.openedAt,
      endAt,
    },
    { initialNumItems: 500 },
  );
  const { status, loadMore } = metrics;
  useEffect(() => {
    if (status === "CanLoadMore") loadMore(500);
  }, [status, loadMore]);
  const summary = useMemo(
    () =>
      status === "Exhausted"
        ? mergeSeriesSegments(metrics.results, session.openedAt, endAt)
        : null,
    [status, metrics.results, session.openedAt, endAt],
  );
  return (
    <div className="grid gap-4 border-b border-border py-5 md:grid-cols-[minmax(0,1fr)_5rem_5rem_minmax(9rem,0.6fr)_minmax(9rem,0.6fr)] md:items-center">
      <div className="min-w-0">
        <button
          className="cursor-pointer text-left text-sm font-semibold text-accent hover:underline"
          onClick={() => onSelect(session.id)}
        >
          {session.worldName ?? "VRChat instance"}
        </button>
        <p className="mt-1 break-all text-xs text-muted">{session.worldId}</p>
        <p className="mt-1 truncate text-xs text-muted">
          {session.providerInstanceId}
        </p>
      </div>
      <div className="flex gap-8 md:contents">
        <div>
          <p className="text-xs text-muted md:hidden">Peak</p>
          <strong className="text-xl font-medium tabular-nums">
            {summary === null ? "…" : metricNumber(summary.peak)}
          </strong>
        </div>
        <div>
          <p className="text-xs text-muted md:hidden">Average</p>
          <strong className="text-xl font-medium tabular-nums">
            {summary === null ? "…" : metricNumber(summary.average, 1)}
          </strong>
        </div>
      </div>
      <div className="text-xs text-muted">
        <span className="md:hidden">Opened · </span>
        {metricTime(session.openedAt)}
      </div>
      <div className="text-xs text-muted">
        <span className="md:hidden">Closed · </span>
        {session.closedAt
          ? metricTime(session.closedAt)
          : session.state === "open"
            ? "Still open"
            : "Unknown"}
      </div>
    </div>
  );
}

export function ClubInstanceList({
  communitySlug,
  kind,
  onSelect,
  compact = false,
}: {
  communitySlug: string;
  kind: "live" | "past";
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  const query = usePaginatedQuery(
    api.clubAnalytics.listInstances,
    { communitySlug, kind },
    { initialNumItems: compact ? 3 : 10 },
  );
  return (
    <div className="min-w-0">
      <div className="mt-5 hidden gap-4 border-b border-border pb-3 text-xs text-muted md:grid md:grid-cols-[minmax(0,1fr)_5rem_5rem_minmax(9rem,0.6fr)_minmax(9rem,0.6fr)]">
        <span>Instance / world</span>
        <span>Peak</span>
        <span>Average</span>
        <span>Opened</span>
        <span>Closed</span>
      </div>
      {query.results.map((session) => (
        <InstanceMetricsRow
          key={session.id}
          communitySlug={communitySlug}
          session={session}
          onSelect={onSelect}
        />
      ))}
      {query.status === "LoadingFirstPage" ? (
        <Notice role="status" className="mt-4">
          Loading instances…
        </Notice>
      ) : query.results.length === 0 ? (
        <Notice variant="dashed" className="mt-4">
          No recorded instances.
        </Notice>
      ) : null}
      {!compact &&
      query.status !== "Exhausted" &&
      query.status !== "LoadingFirstPage" ? (
        <Button
          className="mt-4"
          disabled={query.status === "LoadingMore"}
          onClick={() => query.loadMore(10)}
        >
          {query.status === "LoadingMore" ? "Loading…" : "Load more instances"}
        </Button>
      ) : null}
    </div>
  );
}

function InstanceDetailContent({
  communitySlug,
  session,
  onBack,
}: {
  communitySlug: string;
  session: InstanceRow;
  onBack: () => void;
}) {
  const metrics = useInstancePoints(communitySlug, session);
  return (
    <div className="grid gap-6">
      <Button className="justify-self-start" onClick={onBack}>
        Back to instances
      </Button>
      <Card padding="lg" className="min-w-0">
        <SectionTitle>{session.worldName ?? "Instance detail"}</SectionTitle>
        <ClubEventAssociation sessionId={session.id} />
        {session.state === "open" ? (
          <CloseInstanceAction
            worldId={session.worldId}
            instanceId={session.providerInstanceId}
          />
        ) : null}
        <p className="mt-2 break-all text-sm text-muted">{session.worldId}</p>
        <p className="mt-1 break-all text-xs text-muted">
          {session.providerInstanceId}
        </p>
        <div className="my-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted">Peak</p>
            <p className="mt-1 text-3xl font-semibold">
              {metrics.complete ? metricNumber(metrics.summary?.peak) : "…"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Average</p>
            <p className="mt-1 text-3xl font-semibold">
              {metrics.complete
                ? metricNumber(metrics.summary?.average, 1)
                : "…"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Opened</p>
            <p className="mt-2 text-sm">{metricTime(session.openedAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Closed</p>
            <p className="mt-2 text-sm">
              {session.closedAt
                ? metricTime(session.closedAt)
                : session.state === "open"
                  ? "Still open"
                  : "Unknown"}
            </p>
          </div>
        </div>
        {!metrics.complete ? (
          <Notice role="status">Loading complete instance history…</Notice>
        ) : (
          <ClubChart
            points={observedChartPoints(metrics.results)}
            label="People"
          />
        )}
        <details className="mt-5 border-t border-border pt-4 text-sm">
          <summary className="cursor-pointer">Data completeness</summary>
          <p className="mt-3 text-muted">
            {metrics.complete
              ? `${metricNumber((metrics.summary?.coverageRatio ?? 0) * 100)}% observed time. Average population excludes missing intervals.`
              : "Loading observations…"}
          </p>
        </details>
      </Card>
    </div>
  );
}

export function ClubInstanceDetail({
  communitySlug,
  sessionId,
  onBack,
}: {
  communitySlug: string;
  sessionId: string;
  onBack: () => void;
}) {
  const session = useQuery(api.clubAnalytics.getInstance, {
    communitySlug,
    sessionId: sessionId as Id<"instanceSessions">,
  });
  if (session === undefined)
    return <Notice role="status">Loading instance…</Notice>;
  if (session === null)
    return (
      <div className="grid gap-4">
        <Button onClick={onBack}>Back</Button>
        <Notice variant="warning">Instance unavailable.</Notice>
      </div>
    );
  return (
    <InstanceDetailContent
      communitySlug={communitySlug}
      session={session}
      onBack={onBack}
    />
  );
}

export function ClubInstances() {
  const workspace = useClubWorkspace();
  const { location, update } = useClubRange(30);
  const canReadHistory =
    workspace.readableCategories.includes("instance_history");
  return (
    <>
      {location.instance && canReadHistory ? (
        <ClubInstanceDetail
          communitySlug={workspace.community.slug}
          sessionId={location.instance}
          onBack={() => update({ instance: null })}
        />
      ) : null}
      <div hidden={Boolean(location.instance) && canReadHistory}>
        <div className="grid gap-6">
          <h1 className="text-3xl font-semibold">Instances</h1>
          <ClubInstanceActions />
          {!canReadHistory ? (
            <Notice variant="warning">Instance history is restricted.</Notice>
          ) : (
            (["live", "past"] as const).map((kind) => (
              <Card key={kind} padding="lg" className="min-w-0">
                <SectionTitle>
                  {kind === "live" ? "Live instances" : "Past instances"}
                </SectionTitle>
                <ClubInstanceList
                  communitySlug={workspace.community.slug}
                  kind={kind}
                  onSelect={(instance) => update({ instance })}
                />
              </Card>
            ))
          )}
        </div>
      </div>
    </>
  );
}
