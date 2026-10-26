"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PublicCommunityTelemetrySchema } from "@vrdex/api-contracts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { buildPopulationChartModel, formatPopulationObservation, localStatisticsDate, localStatisticsDay, populationRangeInput, type PopulationSeries, type StatisticsRange } from "@/lib/public-group-statistics";

function ObservationDetails({ point }: { point: ReturnType<typeof buildPopulationChartModel>["observations"][number] }) {
  return <><time dateTime={new Date(point.observedAt).toISOString()}>{formatPopulationObservation(point.observedAt)}</time><p>{point.population.toLocaleString()} people · {point.instanceCount.toLocaleString()} instances</p></>;
}

export function PublicGroupPopulationChart({ series, range, onRangeChange }: {
  series: PopulationSeries;
  range: StatisticsRange;
  onRangeChange: (range: StatisticsRange) => void;
}) {
  const model = buildPopulationChartModel(series, series.endAt);
  const [selected, setSelected] = useState<number | null>(null);
  const [rangeError, setRangeError] = useState(false);
  const observation = selected === null ? undefined : model.observations[selected];
  return <div className="min-w-0 population-history">
    <div className="flex flex-wrap items-end gap-3">
      <h3 className="mr-auto text-sm font-semibold">Population history</h3>
      <Field>Inspect day<Input aria-label="Inspect day" type="date" value={range ? localStatisticsDate(range.startAt) : ""} onChange={event => {
        const next = localStatisticsDay(event.target.value);
        const valid = next === null || (next.endAt <= Date.now() && next.endAt - next.startAt <= 86_400_000);
        setRangeError(!valid);
        if (valid) { setSelected(null); onRangeChange(next); }
      }} /></Field>
      <Button variant="secondary" onClick={() => { setSelected(null); setRangeError(false); onRangeChange(null); }}>Last 24 hours</Button>
    </div>
    {rangeError ? <p className="mt-2 text-sm text-danger" role="alert">Choose a completed day of at most 24 hours.</p> : null}
    {model.observations.length === 0 ? <p className="mt-4 text-sm text-muted">No observations</p> : <>
      <div className="mt-3 h-64 min-w-0" role="img" aria-label="Population history">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={model.points} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="observedAt" type="number" domain={[series.startAt, series.endAt]} tickFormatter={at => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} tickCount={4} tickLine={false} axisLine={false} minTickGap={28} tick={{ fill: "var(--muted)", fontSize: 11 }} />
            <YAxis allowDecimals={false} width={44} domain={[0, "dataMax"]} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
            <Tooltip cursor={false} content={({ active, label }) => {
              const point = active && typeof label === "number" ? model.observations.find(point => point.observedAt === label) : undefined;
              return point ? <div className="rounded-card border border-border bg-surface px-3 py-2 text-sm shadow-panel"><ObservationDetails point={point} /></div> : null;
            }} />
            <Line name="People" dataKey="population" type="linear" stroke="var(--accent)" strokeWidth={2} connectNulls={false} isAnimationActive={false} dot={({ cx, cy, payload }: { cx?: number; cy?: number; payload?: { observedAt: number; population: number | null } }) => payload?.population == null ? <g /> : <circle cx={cx} cy={cy} r={3} fill="var(--accent)" data-observed-at={payload.observedAt} />} />
            <Line name="Instances" dataKey="instanceCount" type="linear" stroke="var(--muted)" strokeWidth={2} strokeDasharray="4 3" connectNulls={false} isAnimationActive={false} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 flex flex-wrap gap-4 text-xs text-muted"><span><span aria-hidden="true" className="mr-1 inline-block w-5 border-t-2 border-accent align-middle" />People</span><span><span aria-hidden="true" className="mr-1 inline-block w-5 border-t-2 border-dashed border-muted align-middle" />Instances</span></p>
      <Field className="mt-3">Observation<input aria-label="Observation" type="range" min={0} max={model.observations.length - 1} value={selected ?? 0} onFocus={() => setSelected(selected ?? 0)} onChange={event => setSelected(Number(event.target.value))} /></Field>
      {observation ? <div className="mt-2 text-sm" role="status" aria-label="Observation details"><ObservationDetails point={observation} /></div> : null}
    </>}
  </div>;
}

export function CommunityPopulationHistory({ slug, initialSeries, currentPopulation }: {
  slug: string;
  initialSeries: PopulationSeries;
  currentPopulation?: { value: number; activeInstanceCount: number; observedAt: number };
}) {
  const [request, setRequest] = useState<{ range: StatisticsRange; revision: number }>({ range: null, revision: 0 });
  const [loadedRange, setLoadedRange] = useState<StatisticsRange>(null);
  const [series, setSeries] = useState<PopulationSeries | undefined>(initialSeries);
  const [current, setCurrent] = useState(currentPopulation);
  const [now, setNow] = useState(initialSeries.endAt);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    const query = new URLSearchParams(Object.entries(populationRangeInput(request.range)).map(([key, value]) => [key, String(value)]));
    void fetch(`/api/v0/communities/${encodeURIComponent(slug)}${query.size ? `?${query}` : ""}`, { signal: abort.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Profile read failed");
        const body: unknown = await response.json();
        const telemetry = PublicCommunityTelemetrySchema.optional().parse(typeof body === "object" && body !== null && "telemetry" in body ? body.telemetry : undefined);
        setSeries(telemetry?.populationSeries);
        setCurrent(telemetry?.currentPopulation);
        setLoadedRange(request.range);
      }).catch(() => { if (!abort.signal.aborted) setError(true); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [request, slug]);
  const fresh = current && now >= current.observedAt && now - current.observedAt <= 360_000;
  return <div className="mt-5 min-w-0">
    <p className="text-xs text-muted">{fresh ? "Current" : "Stale"}</p>
    {fresh ? <Card className="mt-3" padding="sm" surface="strong"><p className="text-sm text-muted">In group instances</p><p className="mt-2 text-3xl font-semibold">{current.value.toLocaleString()} people</p><p className="mt-1 text-xs text-muted">{current.activeInstanceCount.toLocaleString()} active instances</p></Card> : null}
    {error ? <p className="mt-4 text-sm text-danger" role="alert">Profile read failed</p> : null}
    {series ? <div className="mt-6" aria-busy={loading}><PublicGroupPopulationChart series={series} range={loadedRange} onRangeChange={range => { setLoading(true); setError(false); setRequest(previous => ({ range, revision: previous.revision + 1 })); }} /></div> : null}
  </div>;
}
