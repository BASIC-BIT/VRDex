"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import {
  dashboardBounds,
  dashboardHref,
  dashboardLocation,
  defaultDashboardRange,
  localDayRanges,
  type DashboardLocation,
  type RangeDays,
} from "./club-analytics-model";

export function useClubRange(rangeDays: RangeDays) {
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [now] = useState(() => new Date());
  const location = useMemo(
    () =>
      dashboardLocation(new URLSearchParams(search.toString()), rangeDays, now),
    [search, rangeDays, now],
  );
  const update = (value: Partial<DashboardLocation>) =>
    router.push(dashboardHref(pathname, location, value), { scroll: false });
  const days = useMemo(
    () => localDayRanges(location.from, location.to),
    [location.from, location.to],
  );
  return { location, update, bounds: dashboardBounds(location), days };
}

export function ClubRangeControls({
  location,
  update,
}: {
  location: DashboardLocation;
  update: (value: Partial<DashboardLocation>) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field className="min-w-36">
        Date range
        <Select
          aria-label="Date range"
          value="custom"
          onChange={(event) => {
            if (event.target.value !== "custom")
              update({
                ...defaultDashboardRange(
                  Number(event.target.value) as RangeDays,
                ),
                day: null,
                instance: null,
              });
          }}
        >
          <option value="custom">
            {location.from} to {location.to}
          </option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </Select>
      </Field>
      <Field>
        Inspect day
        <Input
          type="date"
          aria-label="Inspect day"
          min={location.from}
          max={location.to}
          value={location.day ?? ""}
          onChange={(event) =>
            update({ day: event.target.value || null, instance: null })
          }
        />
      </Field>
      <Field>
        Month
        <Input
          type="month"
          aria-label="Select month"
          onChange={(event) => {
            if (!/^\d{4}-\d{2}$/.test(event.target.value)) return;
            const [year, month] = event.target.value.split("-").map(Number);
            const end = new Date(year!, month!, 0);
            update({
              from: `${event.target.value}-01`,
              to: `${event.target.value}-${String(end.getDate()).padStart(2, "0")}`,
              day: null,
              instance: null,
            });
          }}
        />
      </Field>
      {location.day ? (
        <Button onClick={() => update({ day: null, instance: null })}>
          Back to range
        </Button>
      ) : null}
    </div>
  );
}
