"use client";

import { useEffect, useState } from "react";
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
  points: Array<{ observedAt: number; value: number; sampledBefore?: true }>;
};

const date = (at: number) => new Date(at).toLocaleDateString("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});
const dateTime = (at: number) => new Date(at).toLocaleString("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
});

export function PublicGroupMembershipChart({ membership }: { membership: GroupMembership }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const observations = [...membership.points];
  if (!observations.some((point) => point.observedAt === membership.latest.observedAt)) {
    observations.push(membership.latest);
  }
  observations.sort((a, b) => a.observedAt - b.observedAt);
  const first = observations[0];
  if (!first) return null;

  const bridge = membership.groupCreatedAt !== undefined && membership.groupCreatedAt < first.observedAt;
  const today = membership.latest.observedAt <= now && now - membership.latest.observedAt <= 48 * 3600_000;
  type Point = { observedAt: number; value: number | null };
  const observedLine: Point[] = [];
  const sampledLine: Point[] = [];
  const unobservedLine: Point[] = bridge ? [{ observedAt: membership.groupCreatedAt!, value: 1 }, first] : [];
  for (const [index, point] of observations.entries()) {
    const previous = observations[index - 1];
    const skippedDay = previous && Math.floor(point.observedAt / 86_400_000) - Math.floor(previous.observedAt / 86_400_000) > 1;
    if (previous && point.sampledBefore) {
      observedLine.push({ observedAt: previous.observedAt + 1, value: null });
      if (sampledLine.length) sampledLine.push({ observedAt: previous.observedAt + 1, value: null });
      sampledLine.push(previous, point);
    } else if (skippedDay) {
      observedLine.push({ observedAt: previous.observedAt + 1, value: null });
      if (unobservedLine.length) unobservedLine.push({ observedAt: previous.observedAt + 1, value: null });
      unobservedLine.push(previous, point);
    }
    observedLine.push(point);
  }
  const axisPoints = bridge ? [{ observedAt: membership.groupCreatedAt!, value: 1 }, ...observations] : observations;

  return <div className="min-w-0">
    <h3 className="text-sm font-semibold">Total group membership</h3>
    {unobservedLine.length > 0 ? <p className="mt-2 text-xs text-muted"><span className="mr-1 inline-block w-5 border-t-2 border-dotted border-muted align-middle" />Unobserved</p> : null}
    <div className="mt-3 h-64 min-w-0" role="group" aria-label="Total group membership">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={axisPoints} accessibilityLayer margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="observedAt" type="number" domain={["dataMin", "dataMax"]} tickFormatter={date} tickCount={3} tickLine={false} axisLine={false} minTickGap={28} tick={{ fill: "var(--muted)", fontSize: 11 }} />
          <YAxis width={48} allowDecimals={false} domain={[0, "dataMax"]} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
          <Tooltip cursor={false} content={({ active, label }) => {
            if (!active || typeof label !== "number") return null;
            const isCreation = bridge && label === membership.groupCreatedAt;
            const point = isCreation ? { observedAt: label, value: 1 } : observations.find((item) => item.observedAt === label);
            if (!point) return null;
            const isToday = today && label === membership.latest.observedAt;
            return <div className="rounded-card border border-border bg-surface px-3 py-2 text-sm shadow-panel">
              <p className="text-muted">{isCreation ? "Group founded" : isToday ? "Today" : date(point.observedAt)}</p>
              {isCreation || isToday ? <p className="mt-1 text-muted">{dateTime(point.observedAt)}</p> : null}
              <p className="mt-1 font-medium">{point.value.toLocaleString()} {point.value === 1 ? "member" : "members"}</p>
            </div>;
          }} />
          {unobservedLine.length > 0 ? <Line data={unobservedLine} dataKey="value" name="Unobserved" type="linear" stroke="var(--muted)" strokeWidth={2} strokeDasharray="3 4" dot={({ cx, cy, payload }: { cx?: number; cy?: number; payload?: Point }) => payload?.observedAt === membership.groupCreatedAt ? <path data-testid="group-founding-dot" d={`M ${cx} ${cy! - 6} L ${cx! + 6} ${cy} L ${cx} ${cy! + 6} L ${cx! - 6} ${cy} Z`} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2} /> : <g />} activeDot={false} isAnimationActive={false} /> : null}
          {sampledLine.length > 0 ? <Line data={sampledLine} dataKey="value" name="Group members" type="linear" stroke="var(--accent)" strokeOpacity={0.55} strokeWidth={2} strokeDasharray="7 5" dot={false} activeDot={false} isAnimationActive={false} /> : null}
          <Line data={observedLine} dataKey="value" name="Group members" type="linear" stroke="var(--accent)" strokeWidth={2} dot={({ cx, cy, payload }: { cx?: number; cy?: number; payload?: Point }) => payload?.value == null ? <g /> : today && payload.observedAt === membership.latest.observedAt ? <g data-testid="group-today-dot"><circle cx={cx} cy={cy} r={7} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2} /><circle cx={cx} cy={cy} r={3} fill="var(--accent)" /></g> : <circle cx={cx} cy={cy} r={3} fill="var(--accent)" />} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  </div>;
}
