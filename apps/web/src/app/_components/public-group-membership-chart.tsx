"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type GroupMembership = {
  groupCreatedAt?: number;
  latest: { value: number; observedAt: number };
  points: Array<{ observedAt: number; value: number }>;
};

const date = (at: number) => new Date(at).toLocaleDateString("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});

export function PublicGroupMembershipChart({ membership }: { membership: GroupMembership }) {
  const observations = [...membership.points];
  if (!observations.some((point) => point.observedAt === membership.latest.observedAt)) {
    observations.push(membership.latest);
  }
  observations.sort((a, b) => a.observedAt - b.observedAt);
  const first = observations[0];
  if (!first) return null;

  const bridge = membership.groupCreatedAt !== undefined && membership.groupCreatedAt < first.observedAt;
  type ChartPoint = { at: number; observed: number | null; unobserved: number | null };
  const points: ChartPoint[] = [
    ...(bridge ? [{ at: membership.groupCreatedAt!, observed: null, unobserved: 0 }] : []),
    ...observations.flatMap((point, index): ChartPoint[] => {
      const previous = observations[index - 1];
      return [
        ...(previous && point.observedAt - previous.observedAt > 36 * 60 * 60 * 1000
          ? [{ at: previous.observedAt + 1, observed: null, unobserved: null }]
          : []),
        { at: point.observedAt, observed: point.value, unobserved: bridge && index === 0 ? point.value : null },
      ];
    }),
  ];

  return <div className="min-w-0">
    <h3 className="text-sm font-semibold">Total group membership</h3>
    {bridge ? <p className="mt-2 text-xs text-muted"><span className="mr-1 inline-block w-5 border-t-2 border-dotted border-muted align-middle" />Unobserved</p> : null}
    <div className="mt-3 h-64 min-w-0" role="group" aria-label="Total group membership">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={points} accessibilityLayer margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="at" type="number" domain={["dataMin", "dataMax"]} tickFormatter={date} tickLine={false} axisLine={false} minTickGap={28} tick={{ fill: "var(--muted)", fontSize: 11 }} />
          <YAxis width={48} allowDecimals={false} domain={[0, "dataMax"]} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
          <Tooltip cursor={false} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0]?.payload as (typeof points)[number] | undefined;
            if (!point) return null;
            return <div className="rounded-card border border-border bg-surface px-3 py-2 text-sm shadow-panel">
              <p className="text-muted">{date(point.at)}</p>
              <p className="mt-1 font-medium">{point.observed === null ? "Unobserved" : `${point.observed.toLocaleString()} Group members`}</p>
            </div>;
          }} />
          {bridge ? <Line dataKey="unobserved" name="Unobserved" type="linear" stroke="var(--muted)" strokeWidth={2} strokeDasharray="3 4" dot={false} activeDot={false} isAnimationActive={false} /> : null}
          <Line dataKey="observed" name="Group members" type="linear" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3, fill: "var(--accent)" }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  </div>;
}
