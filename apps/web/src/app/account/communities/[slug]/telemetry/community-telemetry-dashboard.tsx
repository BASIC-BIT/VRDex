"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { Component, type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

import { api } from "@convex-generated-api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, SectionHeading, SectionTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";
import type { Id } from "../../../../../../../../convex/_generated/dataModel";

type CoverageState = "observed" | "estimated" | "stale" | "unknown" | "degraded";
type PublicMetric = "currentPopulation" | "populationHistory" | "groupMemberCount" | "groupMemberGrowth" | "eventRecaps";

export type TelemetryDashboardData = {
  community: { slug: string; displayName: string };
  integration: {
    state: string;
    groupVisibility: string;
    joinPolicy: string;
    vrchatGroupId: string;
    lastSuccessfulObservationAt?: number;
    freshness: "current" | "stale";
    publicMetrics: Record<PublicMetric, boolean>;
    collector: { accountAlias: string; vrchatUserId: string; state: string } | null;
  };
  summary: {
    currentPopulation?: number;
    activeInstanceCount: number;
    peakConcurrency: number;
    playerHours: number;
    coverageRatio: number;
    groupMemberCount?: number;
    groupMemberGrowth: number;
    worlds: Array<{ worldId: string; samples: number; population?: number }>;
  };
  population: Array<{
    observedAt: number;
    totalPopulation: number;
    activeInstanceCount: number;
    coverageState: CoverageState;
  }>;
  instancePopulation: Array<{
    sessionId: string;
    observedAt: number;
    population: number;
    vrchatWorldId: string;
    coverageState: CoverageState;
  }>;
  memberCounts: Array<{ observedAt: number; memberCount: number }>;
  rollups: Array<{
    _id?: string;
    eventId?: string;
    grain: "hour" | "day" | "event";
    bucketStartAt: number;
    bucketEndAt: number;
    currentPopulation?: number;
    activeInstanceCount: number;
    peakConcurrency: number;
    playerMinutes: number;
    coverageRatio: number;
    groupMemberCount?: number;
    groupMemberGrowth?: number;
    worldDistribution: Array<{ vrchatWorldId: string; samples: number }>;
  }>;
  coverage: Array<{ startedAt: number; endedAt?: number; state: CoverageState; reason?: string }>;
  sessions: Array<{
    _id: string;
    providerInstanceId: string;
    vrchatWorldId: string;
    state: "open" | "closed";
    openedAt: number;
    lastObservedAt: number;
    closedAt?: number;
  }>;
  associations: Array<{
    _id: string;
    eventId: string;
    sessionId: string;
    state: "suggested" | "confirmed" | "rejected";
    confidence: number;
  }>;
  events: Array<{ _id: string; slug: string; title: string; startAt: number; endAt?: number }>;
};

const metrics: Array<{ key: PublicMetric; label: string }> = [
  { key: "currentPopulation", label: "Current population" },
  { key: "populationHistory", label: "Population history" },
  { key: "groupMemberCount", label: "Group member count" },
  { key: "groupMemberGrowth", label: "Group member growth" },
  { key: "eventRecaps", label: "Event recaps" },
];

function formatNumber(value: number | undefined, digits = 0) {
  return value === undefined ? "—" : new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(value);
}

function formatTime(value: number | undefined) {
  return value === undefined ? "Not yet observed" : new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium", timeStyle: "short",
  }).format(new Date(value));
}

type ChartPoint = { at: number; value: number; state?: CoverageState };

function LineChart({
  label,
  maxGapMs = 6 * 60_000,
  points,
}: {
  label: string;
  maxGapMs?: number;
  points: ChartPoint[];
}) {
  const drawablePoints = points.filter((point) => point.state === undefined || point.state === "observed" || point.state === "estimated");
  if (drawablePoints.length < 2) return <Notice variant="dashed">Not enough observed data for this range.</Notice>;
  const width = 720;
  const height = 220;
  const minAt = drawablePoints[0]!.at;
  const maxAt = drawablePoints[drawablePoints.length - 1]!.at;
  const maxValue = Math.max(1, ...drawablePoints.map((point) => point.value));
  const coordinate = (point: ChartPoint) => ({
    x: ((point.at - minAt) / Math.max(1, maxAt - minAt)) * width,
    y: height - (point.value / maxValue) * (height - 16),
  });
  const segments: ChartPoint[][] = [];
  for (const point of drawablePoints) {
    const segment = segments.at(-1);
    const previous = segment?.at(-1);
    if (!segment || !previous || point.at - previous.at > maxGapMs) segments.push([point]);
    else if (point.state !== previous.state) segments.push([previous, point]);
    else segment.push(point);
  }
  return (
    <div>
      <svg aria-label={`${label}. Maximum ${formatNumber(maxValue)}.`} className="h-56 w-full overflow-visible" role="img" viewBox={`0 0 ${width} ${height}`}>
        <line className="stroke-border" x1="0" x2={width} y1={height - 1} y2={height - 1} />
        {segments.map((segment, index) => (
          <polyline
            className="fill-none stroke-accent"
            key={`${segment[0]!.at}-${index}`}
            points={segment.map((point) => { const value = coordinate(point); return `${value.x},${value.y}`; }).join(" ")}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
            strokeDasharray={(segment.at(-1)?.state ?? segment[0]?.state) === "estimated" ? "8 7" : undefined}
          />
        ))}
      </svg>
      <div className="mt-2 flex justify-between text-xs text-muted">
        <span>{formatTime(minAt)}</span>
        <span>{formatTime(maxAt)}</span>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card padding="sm" surface="strong">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-xs text-muted">{detail}</p>
    </Card>
  );
}

function CommunityTelemetryDashboardContent({
  communitySlug,
  fixtureData,
}: {
  communitySlug: string;
  fixtureData?: TelemetryDashboardData;
}) {
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const liveData = useQuery(
    api.communityTelemetry.getPrivateDashboard,
    fixtureData || isAuthLoading || !isAuthenticated ? "skip" : { communitySlug },
  ) as TelemetryDashboardData | null | undefined;
  const data = fixtureData ?? liveData;
  const connectGroup = useMutation(api.communityTelemetry.connectGroup);
  const disconnectGroup = useMutation(api.communityTelemetry.disconnectGroup);
  const setPublicMetric = useMutation(api.communityTelemetry.setPublicMetric);
  const associateEventInstance = useMutation(api.communityTelemetry.associateEventInstance);
  const reviewAssociationSuggestion = useMutation(api.communityTelemetry.reviewAssociationSuggestion);
  const [rangeHours, setRangeHours] = useState(24);
  const [groupId, setGroupId] = useState("");
  const [joinPolicy, setJoinPolicy] = useState<"free" | "request" | "invite">("request");
  const [groupVisibility, setGroupVisibility] = useState<"public" | "private">("private");
  const [eventId, setEventId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [inspectedSessionId, setInspectedSessionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (data?.integration.state === "disconnected") {
      setGroupId((current) => current || data.integration.vrchatGroupId);
    }
  }, [data]);
  const referenceNow = fixtureData?.integration.lastSuccessfulObservationAt ?? Date.now();
  const cutoff = referenceNow - rangeHours * 60 * 60_000;
  const population = useMemo(() => (data?.population ?? []).filter((point) => point.observedAt >= cutoff), [data, cutoff]);
  const members = useMemo(() => (data?.memberCounts ?? []).filter((point) => point.observedAt >= cutoff), [data, cutoff]);
  const populationPoints = useMemo(() => {
    if (!data) return [];
    if (rangeHours === 24) return population.map((point) => ({ at: point.observedAt, value: point.totalPopulation, state: point.coverageState }));
    const grain = rangeHours === 168 ? "hour" : "day";
    return data.rollups
      .filter((rollup) => rollup.grain === grain && rollup.bucketStartAt >= cutoff && rollup.currentPopulation !== undefined && rollup.coverageRatio > 0)
      .map((rollup) => ({ at: rollup.bucketStartAt, value: rollup.currentPopulation ?? rollup.peakConcurrency }));
  }, [cutoff, data, population, rangeHours]);
  const activeInstancePoints = useMemo(() => {
    if (!data) return [];
    if (rangeHours === 24) return population.map((point) => ({ at: point.observedAt, value: point.activeInstanceCount, state: point.coverageState }));
    const grain = rangeHours === 168 ? "hour" : "day";
    return data.rollups
      .filter((rollup) => rollup.grain === grain && rollup.bucketStartAt >= cutoff && rollup.currentPopulation !== undefined && rollup.coverageRatio > 0)
      .map((rollup) => ({ at: rollup.bucketStartAt, value: rollup.activeInstanceCount }));
  }, [cutoff, data, population, rangeHours]);

  async function perform(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    try { await action(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The telemetry change failed."); }
    finally { setBusy(false); }
  }

  async function submitConnection(event: FormEvent) {
    event.preventDefault();
    await perform(() => connectGroup({ communitySlug, vrchatGroupId: groupId, joinPolicy, groupVisibility }), "Connection requested.");
  }

  if (!fixtureData && !isAuthLoading && !isAuthenticated) {
    return <CommunityTelemetryAccessNotice kind="signed-out" />;
  }
  if (!mounted || isAuthLoading || data === undefined) return <Notice>Loading telemetry…</Notice>;
  const reconnecting = data !== null && data.integration.state === "disconnected";
  if (data === null || reconnecting) {
    return (
      <Card padding="lg" surface="strong">
        <SectionHeading description="VRDex assigns one of its own service accounts. Your VRChat credentials are never requested.">
          {reconnecting ? "Reconnect VRChat group" : "Connect VRChat group"}
        </SectionHeading>
        <form className="mt-7 grid gap-5 md:grid-cols-2" onSubmit={submitConnection}>
          <Field className="md:col-span-2">VRChat group ID<Input onChange={(event) => setGroupId(event.target.value)} placeholder="grp_…" required value={groupId} /></Field>
          <Field>Group visibility<Select onChange={(event) => setGroupVisibility(event.target.value as "public" | "private")} value={groupVisibility}><option value="private">Private</option><option value="public">Public</option></Select></Field>
          <Field>Join policy<Select onChange={(event) => setJoinPolicy(event.target.value as typeof joinPolicy)} value={joinPolicy}><option value="free">Free join</option><option value="request">Request to join</option><option value="invite">Invite only</option></Select></Field>
          <Button disabled={busy || Boolean(fixtureData)} type="submit">
            {reconnecting ? "Reconnect group" : "Connect group"}
          </Button>
        </form>
        {message ? <Notice className="mt-5">{message}</Notice> : null}
      </Card>
    );
  }

  const suggested = data.associations.filter((association) => association.state === "suggested");
  const eventNames = new Map(data.events.map((event) => [event._id, event.title]));
  const eventRecaps = data.rollups.filter((rollup) => rollup.grain === "event").slice(-6).reverse();
  const recentSessions = data.sessions.slice(0, 8);
  const inspectedSession = recentSessions.find((session) => session._id === inspectedSessionId) ?? recentSessions[0];
  const inspectedInstancePoints = inspectedSession
    ? data.instancePopulation
      .filter((point) => point.sessionId === inspectedSession._id && point.observedAt >= cutoff)
      .map((point) => ({ at: point.observedAt, value: point.population, state: point.coverageState }))
    : [];
  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{data.integration.vrchatGroupId}</p>
          <h1 className="mt-1 text-4xl font-semibold tracking-tight">{data.community.displayName} telemetry</h1>
          <p className="mt-3 text-sm text-muted">Last observed {formatTime(data.integration.lastSuccessfulObservationAt)}</p>
        </div>
        <div className="flex gap-2">
          <Link className={buttonVariants({ variant: "secondary" })} href={`/c/${data.community.slug}`}>Public profile</Link>
          <Select aria-label="Chart range" onChange={(event) => setRangeHours(Number(event.target.value))} value={rangeHours}>
            <option value={24}>24 hours</option><option value={168}>7 days</option><option value={720}>30 days</option>
          </Select>
        </div>
      </div>

      {message ? <Notice>{message}</Notice> : null}
      {data.integration.freshness === "stale" ? <Notice variant="warning">Collection is stale. Missing time remains a gap and is not reported as zero attendance.</Notice> : null}
      {data.integration.state === "awaiting_approval" ? <Notice variant="warning">Approve the pending service-account membership request in VRChat to begin collection.</Notice> : null}
      {data.integration.state === "awaiting_invite" ? <Notice variant="warning">Invite service account {data.integration.collector?.vrchatUserId ?? "shown below"} to this VRChat group.</Notice> : null}
      {data.integration.state === "auth_required" ? <Notice variant="warning">Collection is stopped while a VRDex operator refreshes this service account.</Notice> : null}
      {data.integration.state === "degraded" ? <Notice variant="warning">Collection is retrying with backoff. Coverage remains marked as degraded until a successful poll.</Notice> : null}
      {data.integration.state === "disconnecting" ? <Notice>Collection and public stats are off. The service account is leaving the VRChat group.</Notice> : null}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <SummaryCard detail={`${data.summary.activeInstanceCount} active instances`} label="Current population" value={formatNumber(data.summary.currentPopulation)} />
        <SummaryCard detail="Observed range" label="Peak concurrency" value={formatNumber(data.summary.peakConcurrency)} />
        <SummaryCard detail="Gap-aware estimate" label="Player hours" value={formatNumber(data.summary.playerHours, 1)} />
        <SummaryCard detail={`${formatNumber(data.summary.groupMemberGrowth)} growth`} label="Group members" value={formatNumber(data.summary.groupMemberCount)} />
        <SummaryCard detail="Observed time only" label="Coverage" value={`${formatNumber(data.summary.coverageRatio * 100, 1)}%`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card padding="lg"><SectionTitle>Population</SectionTitle><div className="mt-7"><LineChart label="Population over time. Solid segments are observed, dashed segments are estimated, and missing coverage is blank" maxGapMs={rangeHours === 24 ? 6 * 60_000 : rangeHours === 168 ? 2 * 60 * 60_000 : 2 * 24 * 60 * 60_000} points={populationPoints} /></div><p className="mt-4 text-xs text-muted">Solid observed · dashed estimated · blank missing</p></Card>
        <Card padding="lg"><SectionTitle>Active instances</SectionTitle><div className="mt-7"><LineChart label="Active instances over time" maxGapMs={rangeHours === 24 ? 6 * 60_000 : rangeHours === 168 ? 2 * 60 * 60_000 : 2 * 24 * 60 * 60_000} points={activeInstancePoints} /></div></Card>
        <Card padding="lg"><SectionTitle>Group members</SectionTitle><div className="mt-7"><LineChart label="Group members over time" maxGapMs={7 * 60 * 60_000} points={members.map((point) => ({ at: point.observedAt, value: point.memberCount }))} /></div></Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card padding="lg">
          <SectionHeading description="A session closes after consecutive missed observations. Reopened provider instances become a new session.">Recent instances</SectionHeading>
          <div className="mt-6 grid gap-2">
            {recentSessions.length === 0 ? <Notice variant="dashed">No instance sessions observed yet.</Notice> : recentSessions.map((session) => {
              const endedAt = session.closedAt ?? session.lastObservedAt;
              const durationMinutes = Math.max(0, Math.round((endedAt - session.openedAt) / 60_000));
              return (
                <div className="grid gap-1 border-b border-border py-3 text-sm sm:grid-cols-[1fr_auto_auto] sm:gap-5" key={session._id}>
                  <div><span className="font-medium">{session.vrchatWorldId}</span><span className="mt-1 block text-xs text-muted">Opened {formatTime(session.openedAt)}</span></div>
                  <span>{formatNumber(durationMinutes)} min</span>
                  <span className={session.state === "open" ? "text-success" : "text-muted"}>{session.state}</span>
                </div>
              );
            })}
          </div>
          {inspectedSession ? <div className="mt-7 border-t border-border pt-6"><Field>Instance history<Select onChange={(event) => setInspectedSessionId(event.target.value)} value={inspectedSession._id}>{recentSessions.map((session) => <option key={session._id} value={session._id}>{session.vrchatWorldId} · {formatTime(session.openedAt)}</option>)}</Select></Field><div className="mt-5"><LineChart label={`${inspectedSession.vrchatWorldId} instance population`} points={inspectedInstancePoints} /></div></div> : null}
        </Card>
        <Card padding="lg">
          <SectionHeading description="Current observed distribution, aggregated without user identities.">Active worlds</SectionHeading>
          <div className="mt-6 grid gap-2">
            {data.summary.worlds.length === 0 ? <Notice variant="dashed">No active worlds observed.</Notice> : data.summary.worlds.map((world) => (
              <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-border py-3 text-sm" key={world.worldId}>
                <div><span className="font-medium">{world.worldId}</span><span className="mt-1 block text-xs text-muted">{formatNumber(world.samples)} active {world.samples === 1 ? "instance" : "instances"}</span></div>
                <span>{formatNumber(world.population)} people</span>
              </div>
            ))}
          </div>
          {eventRecaps.length > 0 ? <div className="mt-8"><h3 className="text-xl font-semibold tracking-tight">Recent event recaps</h3><div className="mt-4 grid gap-3">{eventRecaps.map((recap) => <div className="border-t border-border pt-4 text-sm" key={`${recap.eventId ?? "event"}-${recap.bucketStartAt}`}><p className="font-medium">{recap.eventId ? eventNames.get(recap.eventId) ?? "Event" : "Event"}</p><p className="mt-1 text-muted">Peak {formatNumber(recap.peakConcurrency)} · {formatNumber(recap.playerMinutes / 60, 1)} player hours · {formatNumber((recap.bucketEndAt - recap.bucketStartAt) / 60_000)} min · {formatNumber(recap.coverageRatio * 100, 1)}% coverage</p></div>)}</div></div> : null}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card padding="lg">
          <SectionHeading description="Unknown and degraded windows remain visible instead of becoming zeroes.">Coverage</SectionHeading>
          <div className="mt-6 grid gap-2">
            {data.coverage.slice(-12).map((window) => (
              <div className="grid gap-2 border-b border-border py-3 text-sm sm:grid-cols-[8rem_1fr_auto]" key={`${window.startedAt}-${window.state}`}>
                <span className={cn("font-medium", window.state === "observed" ? "text-success" : "text-warning-strong")}>{window.state}</span>
                <span>{formatTime(window.startedAt)} – {window.endedAt ? formatTime(window.endedAt) : "now"}</span>
                <span className="text-muted">{window.reason ?? "Provider observation"}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card padding="lg">
          <SectionHeading description="Each metric stays private until enabled here.">Public stats</SectionHeading>
          <div className="mt-6 grid gap-3">
            {metrics.map((metric) => (
              <label className="flex items-center justify-between gap-4 border-b border-border py-3 text-sm" key={metric.key}>
                <span>{metric.label}</span>
                <input
                  checked={data.integration.publicMetrics[metric.key]}
                  className="size-5 accent-accent"
                  disabled={busy || Boolean(fixtureData)}
                  onChange={(event) => perform(() => setPublicMetric({ communitySlug, metric: metric.key, enabled: event.target.checked }), `${metric.label} visibility updated.`)}
                  type="checkbox"
                />
              </label>
            ))}
          </div>
        </Card>
      </div>

      <Card padding="lg">
        <SectionHeading description="Confirm a session explicitly. Automated suggestions remain private until reviewed.">Event associations</SectionHeading>
        <form className="mt-6 grid gap-4 md:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => {
          event.preventDefault();
          if (!eventId || !sessionId) return;
          void perform(() => associateEventInstance({ communitySlug, eventId: eventId as Id<"events">, sessionId: sessionId as Id<"instanceSessions"> }), "Event association confirmed.");
        }}>
          <Field>Event<Select onChange={(event) => setEventId(event.target.value)} required value={eventId}><option value="">Select event</option>{data.events.map((item) => <option key={item._id} value={item._id}>{item.title}</option>)}</Select></Field>
          <Field>Instance session<Select onChange={(event) => setSessionId(event.target.value)} required value={sessionId}><option value="">Select session</option>{data.sessions.map((session) => <option key={session._id} value={session._id}>{session.vrchatWorldId} · {formatTime(session.openedAt)}</option>)}</Select></Field>
          <Button className="self-end" disabled={busy || Boolean(fixtureData)} type="submit">Confirm</Button>
        </form>
        {suggested.length > 0 ? <div className="mt-7 grid gap-3">{suggested.map((association) => <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4" key={association._id}><span className="text-sm">Suggested match · {formatNumber(association.confidence * 100)}% confidence</span><div className="flex gap-2"><Button disabled={busy || Boolean(fixtureData)} onClick={() => perform(() => reviewAssociationSuggestion({ communitySlug, associationId: association._id as Id<"eventInstanceAssociations">, state: "confirmed" }), "Suggestion confirmed.")} size="sm">Confirm</Button><Button disabled={busy || Boolean(fixtureData)} onClick={() => perform(() => reviewAssociationSuggestion({ communitySlug, associationId: association._id as Id<"eventInstanceAssociations">, state: "rejected" }), "Suggestion rejected.")} size="sm" variant="secondary">Reject</Button></div></div>)}</div> : null}
      </Card>

      <Card padding="lg" surface="strong">
        <SectionHeading description="Disconnect stops collection and public presentation immediately. Existing private history is retained.">Connection</SectionHeading>
        <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3"><div><span className="block text-muted">State</span><span className="mt-1 block font-medium">{data.integration.state}</span></div><div><span className="block text-muted">Service account</span><span className="mt-1 block font-medium">{data.integration.collector?.vrchatUserId ?? "Unassigned"}</span></div><div><span className="block text-muted">Join policy</span><span className="mt-1 block font-medium">{data.integration.joinPolicy}</span></div></div>
        <Button className="mt-7" disabled={busy || Boolean(fixtureData) || data.integration.state === "disconnecting"} onClick={() => perform(() => disconnectGroup({ communitySlug }), "Disconnect requested.")} variant="secondary">{data.integration.state === "disconnecting" ? "Disconnecting" : "Disconnect"}</Button>
      </Card>
    </div>
  );
}

export function CommunityTelemetryAccessNotice({ kind }: { kind: "forbidden" | "signed-out" | "unavailable" }) {
  if (kind === "signed-out") {
    return (
      <Card padding="lg" surface="strong">
        <SectionTitle>Sign in to view telemetry</SectionTitle>
        <p className="mt-3 text-sm leading-7 text-muted">This private dashboard is available to authorized community staff.</p>
        <Link className={cn(buttonVariants({ size: "lg", variant: "primary" }), "mt-5")} href="/sign-in">
          Sign in
        </Link>
      </Card>
    );
  }
  return (
    <Card padding="lg" surface="strong">
      <SectionTitle>{kind === "forbidden" ? "Telemetry access required" : "Telemetry is temporarily unavailable"}</SectionTitle>
      <p className="mt-3 text-sm leading-7 text-muted">
        {kind === "forbidden"
          ? "Ask the community owner for permission to manage integrations."
          : "Try loading this dashboard again shortly."}
      </p>
      <Link className={cn(buttonVariants({ size: "lg", variant: "secondary" }), "mt-5")} href="/account">
        Back to account
      </Link>
    </Card>
  );
}

class CommunityTelemetryDashboardErrorBoundary extends Component<
  { children: ReactNode; communitySlug: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error("Telemetry query failed.") };
  }

  componentDidUpdate(previousProps: { children: ReactNode; communitySlug: string }) {
    if (previousProps.communitySlug !== this.props.communitySlug && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      const forbidden = this.state.error.message.includes("permission to manage this community integration");
      return <CommunityTelemetryAccessNotice kind={forbidden ? "forbidden" : "unavailable"} />;
    }
    return this.props.children;
  }
}

export function CommunityTelemetryDashboard({
  communitySlug,
  fixtureData,
}: {
  communitySlug: string;
  fixtureData?: TelemetryDashboardData;
}) {
  return (
    <CommunityTelemetryDashboardErrorBoundary communitySlug={communitySlug}>
      <CommunityTelemetryDashboardContent communitySlug={communitySlug} fixtureData={fixtureData} />
    </CommunityTelemetryDashboardErrorBoundary>
  );
}
