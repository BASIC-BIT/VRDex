"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
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
}: {
  points: ClubChartPoint[];
  label: string;
  kind?: "bar" | "line";
  onSelect?: (at: number) => void;
}) {
  const [table, setTable] = useState(false);
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
              formatter={(value) => [
                metricNumber(typeof value === "number" ? value : null),
                label,
              ]}
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
                dot={false}
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
                <th>{label}</th>
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
                  <td className="py-2">{metricTime(point.at)}</td>
                  <td>{metricNumber(point.value)}</td>
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
