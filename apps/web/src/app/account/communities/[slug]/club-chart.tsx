"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export type ClubChartPoint = {
  at: number;
  value: number | null;
  label: string;
  founding?: boolean;
  today?: boolean;
};
export const metricNumber = (value: number | null | undefined, digits = 0) =>
  value == null
    ? "Unknown"
    : new Intl.NumberFormat(undefined, {
        maximumFractionDigits: digits,
      }).format(value);
export const metricTime = (value: number | null | undefined) =>
  value == null
    ? "Unknown"
    : new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });

export function ClubChart({
  points,
  label,
  kind = "line",
  onSelect,
  showIsolatedPoints = false,
}: {
  points: ClubChartPoint[];
  label: string;
  kind?: "bar" | "line";
  onSelect?: (at: number) => void;
  showIsolatedPoints?: boolean;
}) {
  const [table, setTable] = useState(false);
  const founding = points.find((point) => point.founding);
  const firstAfterFounding = founding && points.find((point) => point.at > founding.at && point.value !== null);
  if (!points.some((point) => point.value !== null))
    return <Notice variant="dashed">No observations in this range.</Notice>;
  return (
    <div className="min-w-0">
      <div className="h-64 min-w-0" role="group" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart
            data={points}
            margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
            accessibilityLayer
            onClick={(state) => {
              if (state.activeTooltipIndex == null) return;
              const point = points[Number(state.activeTooltipIndex)];
              if (point && onSelect) onSelect(point.at);
            }}
          >
            <CartesianGrid stroke="var(--border)" vertical={false} />
            {founding && firstAfterFounding ? <ReferenceLine segment={[
              { x: founding.label, y: founding.value! },
              { x: firstAfterFounding.label, y: firstAfterFounding.value! },
            ]} stroke="var(--muted)" strokeWidth={2} strokeDasharray="3 4" /> : null}
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              minTickGap={28}
            />
            <YAxis
              width={48}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
            />
            <Tooltip
              cursor={false}
              contentStyle={{
                background: "var(--surface)",
                borderColor: "var(--border)",
                borderRadius: 4,
                color: "var(--foreground)",
              }}
              formatter={(value, _name, entry) => [
                metricNumber(typeof value === "number" ? value : null),
                (entry.payload as ClubChartPoint).founding || (entry.payload as ClubChartPoint).today
                  ? value === 1 ? "member" : "members" : label,
              ]}
              labelFormatter={(axisLabel, payload) => {
                const point = payload?.[0]?.payload as ClubChartPoint | undefined;
                return point?.founding ? `Group founded · ${metricTime(point.at)}`
                  : point?.today ? `Today · ${metricTime(point.at)}` : axisLabel;
              }}
            />
            {kind === "bar" ? (
              <Bar
                dataKey="value"
                name={label}
                fill="var(--accent)"
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            ) : (
              <Line
                dataKey="value"
                name={label}
                type="linear"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={
                  showIsolatedPoints
                    ? ({
                        cx,
                        cy,
                        index,
                      }: {
                        cx?: number;
                        cy?: number;
                        index?: number;
                      }) => {
                        const position = index ?? -1;
                        const point = points[position];
                        if (point?.founding) return <path data-testid="staff-group-founding-dot" d={`M ${cx} ${cy! - 6} L ${cx! + 6} ${cy} L ${cx} ${cy! + 6} L ${cx! - 6} ${cy} Z`} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2} />;
                        if (point?.today) return <g data-testid="staff-group-today-dot"><circle cx={cx} cy={cy} r={7} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2} /><circle cx={cx} cy={cy} r={3} fill="var(--accent)" /></g>;
                        const isolated =
                          point?.value != null &&
                          points[position - 1]?.value == null &&
                          points[position + 1]?.value == null;
                        return (
                          <circle
                            cx={cx}
                            cy={cy}
                            r={isolated ? 3 : 0}
                            fill="var(--accent)"
                          />
                        );
                      }
                    : false
                }
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="mt-3"
        onClick={() => setTable((value) => !value)}
        aria-expanded={table}
      >
        {table ? "Hide data table" : "Show data table"}
      </Button>
      {table ? (
        <div className="relative mt-3 max-h-80 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2">Time</th>
                <th className="hidden sm:table-cell">{label}</th>
                {onSelect ? (
                  <th>
                    <span className="sr-only">Inspect</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.at} className="border-b border-border">
                  <td className="py-2">{point.founding ? "Group founded · " : point.today ? "Today · " : ""}{metricTime(point.at)}<span className="block font-medium sm:hidden" aria-label={`${label}: ${metricNumber(point.value)}`}>{metricNumber(point.value)}</span></td>
                  <td className="hidden sm:table-cell">{metricNumber(point.value)}</td>
                  {onSelect ? (
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onSelect(point.at)}
                      >
                        Inspect day
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
