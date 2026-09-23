"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useClubDisplayAttempt,
  useClubDisplayFreshness,
} from "./club-display-freshness";
import {
  useMutation,
  usePaginatedQuery,
  useQueries,
  useQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex-generated-api";
import { Card, SectionTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckboxField, Field, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { ClubChart, metricNumber, metricTime } from "./club-chart";
import { ClubAssociationSuggestions } from "./club-association-suggestions";
import {
  ClubInstanceDetail,
  ClubInstanceList,
  observedChartPoints,
} from "./club-instances";
import { ClubRangeControls, useClubRange } from "./club-range";
import {
  membershipChartPoints,
  membershipRangePoints,
  homeWidgetLabels,
  localDateKey,
  moveWidget,
  type RangeDays,
} from "./club-analytics-model";
import { useClubWorkspace } from "./club-workspace";
import {
  ClubMembershipMovement,
  ClubMembershipActivity,
} from "./club-membership";

type Context = FunctionReturnType<typeof api.clubAnalytics.getContext>;
type Bucket = FunctionReturnType<typeof api.clubAnalytics.getBucket>;

function PreferencesEditor({
  communitySlug,
  owner,
  context,
  onClose,
}: {
  communitySlug: string;
  owner: boolean;
  context: Context;
  onClose: () => void;
}) {
  const save = useMutation(api.clubAnalytics.savePreferences);
  const reset = useMutation(api.clubAnalytics.resetPersonalPreferences);
  const [scope, setScope] = useState<"personal" | "club">("personal");
  const [widgets, setWidgets] = useState(context.preferences.widgets);
  const [rangeDays, setRangeDays] = useState<RangeDays>(
    context.preferences.rangeDays,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setScopeValues = (next: "personal" | "club") => {
    setScope(next);
    const preference =
      next === "club" ? context.clubDefaults : context.preferences;
    setWidgets(preference.widgets);
    setRangeDays(preference.rangeDays);
  };
  return (
    <Card padding="lg">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle>Customize Home</SectionTitle>
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        {owner ? (
          <Field>
            Apply to
            <Select
              value={scope}
              onChange={(event) =>
                setScopeValues(event.target.value as typeof scope)
              }
            >
              <option value="personal">My dashboard</option>
              <option value="club">Club default</option>
            </Select>
          </Field>
        ) : null}
        <Field>
          Preferred range
          <Select
            value={rangeDays}
            onChange={(event) =>
              setRangeDays(Number(event.target.value) as RangeDays)
            }
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </Select>
        </Field>
      </div>
      <div className="mt-5 grid gap-2">
        {[
          ...widgets,
          ...Object.keys(homeWidgetLabels).filter(
            (key) => !widgets.includes(key),
          ),
        ].map((widget) => (
          <div
            key={widget}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2"
          >
            <CheckboxField
              checked={widgets.includes(widget)}
              onChange={(event) =>
                setWidgets((value) =>
                  event.target.checked
                    ? [...value, widget]
                    : value.filter((id) => id !== widget),
                )
              }
            >
              {homeWidgetLabels[widget as keyof typeof homeWidgetLabels]}
            </CheckboxField>
            <div className="flex gap-1">
              <Button
                size="sm"
                aria-label={`Move ${homeWidgetLabels[widget as keyof typeof homeWidgetLabels]} up`}
                disabled={
                  !widgets.includes(widget) || widgets.indexOf(widget) === 0
                }
                onClick={() =>
                  setWidgets((value) => moveWidget(value, widget, -1))
                }
              >
                Up
              </Button>
              <Button
                size="sm"
                aria-label={`Move ${homeWidgetLabels[widget as keyof typeof homeWidgetLabels]} down`}
                disabled={
                  !widgets.includes(widget) ||
                  widgets.indexOf(widget) === widgets.length - 1
                }
                onClick={() =>
                  setWidgets((value) => moveWidget(value, widget, 1))
                }
              >
                Down
              </Button>
            </div>
          </div>
        ))}
      </div>
      {error ? (
        <Notice className="mt-4" variant="error" role="alert">
          {error}
        </Notice>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-3">
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await save({ communitySlug, scope, widgets, rangeDays });
              onClose();
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Unable to save dashboard.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Save dashboard
        </Button>
        {scope === "personal" ? (
          <Button
            disabled={busy || !context.savedPersonal}
            onClick={async () => {
              setBusy(true);
              try {
                await reset({ communitySlug });
                onClose();
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Unable to reset dashboard.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Reset to club default
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function DailyDetail({
  communitySlug,
  startAt,
  endAt,
  kind,
}: {
  communitySlug: string;
  startAt: number;
  endAt: number;
  kind: "population" | "members";
}) {
  const query = usePaginatedQuery(
    api.clubAnalytics.getSeries,
    { communitySlug, startAt, endAt, kind },
    { initialNumItems: 500 },
  );
  const memberCoverage = useQuery(
    api.clubAnalytics.getMembershipCoverage,
    kind === "members" ? { communitySlug, startAt, endAt } : "skip",
  );
  const { status, loadMore } = query;
  useEffect(() => {
    if (status === "CanLoadMore") loadMore(500);
  }, [status, loadMore]);
  if (query.status !== "Exhausted" || (kind === "members" && !memberCoverage))
    return <Notice role="status">Loading complete day…</Notice>;
  const points =
    kind === "population"
      ? observedChartPoints(query.results)
      : membershipChartPoints(query.results, memberCoverage?.intervals ?? []);

  return (
    <ClubChart
      points={points}
      showIsolatedPoints={kind === "members"}
      label={kind === "population" ? "People" : "Group members"}
    />
  );
}

function EventRecaps({
  communitySlug,
  startAt,
  endAt,
}: {
  communitySlug: string;
  startAt: number;
  endAt: number;
}) {
  const query = usePaginatedQuery(
    api.clubAnalytics.listEventRecaps,
    { communitySlug, startAt, endAt },
    { initialNumItems: 5 },
  );
  return (
    <Card padding="lg" className="min-w-0">
      <SectionTitle>Event recaps</SectionTitle>
      {query.results.map((recap) => (
        <div key={recap.id} className="mt-4 border-t border-border pt-4">
          <h3 className="font-semibold">{recap.title}</h3>
          <p className="mt-1 text-xs text-muted">{metricTime(recap.startAt)}</p>
          <div className="mt-3 flex gap-6 text-sm">
            <span>
              <strong>{metricNumber(recap.peak)}</strong> peak
            </span>
            <span>
              <strong>{metricNumber(recap.playerHours, 1)}</strong> player-hours
            </span>
          </div>
        </div>
      ))}
      {query.status === "LoadingFirstPage" ? (
        <Notice className="mt-4">Loading recaps…</Notice>
      ) : query.results.length === 0 ? (
        <Notice className="mt-4" variant="dashed">
          No event recaps in this range.
        </Notice>
      ) : null}
      {query.status === "CanLoadMore" ? (
        <Button className="mt-4" onClick={() => query.loadMore(5)}>
          Load more recaps
        </Button>
      ) : null}
    </Card>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | null | undefined;
  detail?: string;
}) {
  return (
    <Card padding="sm" surface="strong">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">
        {metricNumber(value)}
      </p>
      {detail ? <p className="mt-2 text-xs text-muted">{detail}</p> : null}
    </Card>
  );
}

export function ClubAnalyticsContent({
  context,
  currentFresh,
  mode = "home",
}: {
  context: Context;
  currentFresh: boolean;
  mode?: "home" | "analytics";
}) {
  const workspace = useClubWorkspace();
  const communitySlug = workspace.community.slug;
  const { location, update, bounds, days } = useClubRange(
    context.preferences.rangeDays,
  );
  const [customize, setCustomize] = useState(false);
  const can = (category: (typeof context.readableCategories)[number]) =>
    context.readableCategories.includes(category);
  const membershipAttempt = useClubDisplayAttempt(
    JSON.stringify([communitySlug, location.from, location.to]),
  );
  const bucketQueries = useMemo(
    () =>
      Object.fromEntries(
        days.map((day) => [
          day.key,
          {
            query: api.clubAnalytics.getBucket,
            args: {
              communitySlug,
              startAt: day.startAt,
              endAt: day.endAt,
              freshnessNonce: membershipAttempt.attempt.nonce,
            },
          },
        ]),
      ),
    [communitySlug, days, membershipAttempt.attempt.nonce],
  );
  const bucketResults = useQueries(bucketQueries) as Record<
    string,
    Bucket | Error | undefined
  >;
  const buckets = days.map((day) => bucketResults[day.key]);
  const loading = buckets.some((bucket) => bucket === undefined);
  const failed = buckets.some((bucket) => bucket instanceof Error);
  const loaded = buckets.filter(
    (bucket): bucket is Bucket =>
      bucket !== undefined && !(bucket instanceof Error),
  );
  const incomplete = loaded.some((bucket) => !bucket.complete);
  const widgets: readonly string[] =
    mode === "home"
      ? context.preferences.widgets
      : [
          "current",
          "activity",
          "movement",
          "membership_activity",
          "membership",
          "recaps",
        ];
  const activityPoints = loaded.map((bucket) => ({
    at: bucket.startAt,
    value: bucket.population?.peak ?? null,
    label: new Date(bucket.startAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  }));
  const expiringMembership = loaded.find(
    (bucket) => bucket.membership?.continuousUntil != null,
  );
  // Reuse the server-calibrated monotonic timer. New reactive server evaluations
  // change the remaining duration, never the original absolute expiry.
  const membershipCoverageFresh = useClubDisplayFreshness(
    membershipAttempt,
    expiringMembership?.now ?? (loading ? undefined : null),
    expiringMembership?.now,
    (expiringMembership?.membership?.continuousUntil ?? 0) -
      (expiringMembership?.now ?? 0),
  );
  const memberPoints = membershipRangePoints(loaded, membershipCoverageFresh);
  const selectDay = (at: number) =>
    update({ day: localDateKey(new Date(at)), instance: null });
  return (
    <>
      {location.instance ? (
        <ClubInstanceDetail
          communitySlug={communitySlug}
          sessionId={location.instance}
          onBack={() => update({ instance: null })}
        />
      ) : null}
      <div hidden={Boolean(location.instance)}>
        <div className="grid gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold">
              {mode === "home" ? "Home" : "Analytics"}
            </h1>
            {mode === "home" ? (
              <Button onClick={() => setCustomize((value) => !value)}>
                Customize
              </Button>
            ) : null}
          </div>
          <ClubRangeControls location={location} update={update} />
          {customize ? (
            <PreferencesEditor
              communitySlug={communitySlug}
              owner={workspace.actor.kind === "owner"}
              context={context}
              onClose={() => setCustomize(false)}
            />
          ) : null}
          {context.epochStartedAt === null ? (
            <Notice>No telemetry yet.</Notice>
          ) : null}
          {failed ? (
            <Notice variant="error" role="alert">
              Unable to load this range.
            </Notice>
          ) : null}
          {incomplete ? (
            <Notice variant="warning">
              Some days exceed the available summary size. Their values are
              omitted.
            </Notice>
          ) : null}
          {widgets.length === 0 ? (
            <Notice variant="dashed">No widgets selected.</Notice>
          ) : null}
          {widgets.map((widget) => {
            if (widget === "current")
              return (
                <div
                  key={widget}
                  className="grid grid-cols-2 gap-3 xl:grid-cols-4"
                >
                  {can("current_population") ? (
                    <>
                      <Metric
                        label="People now"
                        value={
                          currentFresh ? context.current.population : undefined
                        }
                        detail={
                          context.current.observedAt
                            ? `Observed ${metricTime(context.current.observedAt)}`
                            : undefined
                        }
                      />
                      <Metric
                        label="Live instances"
                        value={
                          currentFresh
                            ? context.current.activeInstances
                            : undefined
                        }
                      />
                    </>
                  ) : null}
                  {can("group_size") ? (
                    <Metric
                      label="Group members"
                      value={context.current.groupMemberCount}
                    />
                  ) : null}
                  {can("population_history") ? (
                    <Metric
                      label="Observed peak"
                      value={
                        loading || incomplete
                          ? undefined
                          : loaded.reduce<number | null>(
                              (peak, bucket) =>
                                bucket.population?.peak == null
                                  ? peak
                                  : Math.max(peak ?? 0, bucket.population.peak),
                              null,
                            )
                      }
                    />
                  ) : null}
                </div>
              );
            if (widget === "activity" && can("population_history"))
              return (
                <Card key={widget} padding="lg" className="min-w-0">
                  <SectionTitle>
                    {location.day
                      ? "Activity on selected day"
                      : "Daily activity"}
                  </SectionTitle>
                  <p className="mt-2 mb-5 text-xs text-muted">
                    {location.day
                      ? "Observed population"
                      : "Peak observed people per day"}
                  </p>
                  {location.day ? (
                    <DailyDetail
                      communitySlug={communitySlug}
                      {...bounds}
                      kind="population"
                    />
                  ) : loading ? (
                    <Notice role="status">Loading daily activity…</Notice>
                  ) : (
                    <ClubChart
                      points={activityPoints}
                      label="Peak people"
                      kind="bar"
                      onSelect={selectDay}
                    />
                  )}
                </Card>
              );
            if (widget === "membership" && can("group_size"))
              return (
                <Card key={widget} padding="lg" className="min-w-0">
                  <SectionTitle>Total group membership</SectionTitle>
                  <div className="mt-5">
                    {location.day ? (
                      <DailyDetail
                        communitySlug={communitySlug}
                        {...bounds}
                        kind="members"
                      />
                    ) : loading ? (
                      <Notice role="status">Loading membership…</Notice>
                    ) : (
                      <ClubChart
                        points={memberPoints}
                        showIsolatedPoints
                        label="Group members"
                        onSelect={selectDay}
                      />
                    )}
                  </div>
                </Card>
              );
            if (widget === "movement" && can("membership_movement"))
              return (
                <ClubMembershipMovement
                  key={widget}
                  communitySlug={communitySlug}
                  days={
                    location.day
                      ? days.filter((day) => day.key === location.day)
                      : days
                  }
                  onSelect={selectDay}
                />
              );
            if (
              widget === "membership_activity" &&
              can("individual_membership_history")
            )
              return (
                <ClubMembershipActivity
                  key={widget}
                  communitySlug={communitySlug}
                  {...bounds}
                />
              );
            if (widget === "instances" && can("instance_history"))
              return (
                <Card key={widget} padding="lg" className="min-w-0">
                  <SectionTitle>Recent instances</SectionTitle>
                  <ClubInstanceList
                    communitySlug={communitySlug}
                    kind="past"
                    compact
                    onSelect={(instance) => update({ instance })}
                  />
                </Card>
              );
            if (widget === "recaps" && can("event_recaps"))
              return (
                <EventRecaps
                  key={widget}
                  communitySlug={communitySlug}
                  {...bounds}
                />
              );
            return null;
          })}
          {mode === "analytics" ? (
            <ClubAssociationSuggestions
              onSelectInstance={(instance) => update({ instance })}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

export function ClubAnalytics({
  mode = "home",
}: {
  mode?: "home" | "analytics";
}) {
  const workspace = useClubWorkspace();
  const timing = useClubDisplayAttempt(workspace.community.slug);
  const context = useQuery(api.clubAnalytics.getContext, {
    communitySlug: workspace.community.slug,
    freshnessNonce: timing.attempt.nonce,
  });
  const currentFresh = useClubDisplayFreshness(
    timing,
    context?.now,
    context?.current.observedAt,
    360_000,
  );
  if (context === undefined)
    return <Notice role="status">Loading analytics…</Notice>;
  return (
    <ClubAnalyticsContent
      context={context}
      currentFresh={currentFresh}
      mode={mode}
    />
  );
}
