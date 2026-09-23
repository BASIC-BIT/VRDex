"use client";
import { useRef, useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { Field, Input, Select, CheckboxField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useClubWorkspace } from "./club-workspace";
import { useClubProviderRead } from "./club-provider-read";
import { metricTime } from "./club-chart";

type Submission = FunctionArgs<typeof api.clubOperations.enqueue>;
type CreatePayload = Extract<
  Submission["payloads"][number],
  { kind: "create_instance" }
>;
type EventOption = {
  id: Id<"events">;
  title: string;
  startAt: number;
  status: string;
};
const worldIdPattern =
  /^wrld_[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

export function InstanceCreateForm({
  events,
  roles,
  rolesReady,
  onLoadRoles,
  onSubmit,
}: {
  events: EventOption[];
  roles: { id: string; name?: string }[];
  rolesReady: boolean;
  onLoadRoles: () => void;
  onSubmit: (
    payload: CreatePayload,
    schedule: Submission["schedule"],
  ) => Promise<unknown>;
}) {
  const [worldId, setWorldId] = useState("");
  const [access, setAccess] = useState<CreatePayload["access"]>("members");
  const [region, setRegion] = useState<CreatePayload["region"]>("use");
  const [ageGated, setAgeGated] = useState(false);
  const [queueEnabled, setQueueEnabled] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [eventId, setEventId] = useState("");
  const [when, setWhen] = useState<"now" | "fixed" | "event_relative">("now");
  const [fixedAt, setFixedAt] = useState("");
  const [offsetMinutes, setOffsetMinutes] = useState("-30");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const retry = useRef<{
    key: string;
    payload: CreatePayload;
    schedule: Submission["schedule"];
  } | null>(null);
  const selected = events.find((event) => event.id === eventId);
  const previewOffset = Number(offsetMinutes);
  const scheduledAt =
    when === "fixed"
      ? new Date(fixedAt).getTime()
      : when === "event_relative" &&
          selected &&
          offsetMinutes.trim() &&
          Number.isInteger(previewOffset) &&
          Math.abs(previewOffset) <= 525600
        ? selected.startAt + previewOffset * 60_000
        : null;
  async function submit() {
    setError("");
    setMessage("");
    try {
      if (!worldIdPattern.test(worldId.trim()))
        throw new Error("Enter a valid VRChat world ID.");
      if (restricted && (!rolesReady || roleIds.length === 0))
        throw new Error("Select at least one group role.");
      if (when === "event_relative" && !selected)
        throw new Error("Select an event.");
      const offset = Number(offsetMinutes);
      if (
        when === "event_relative" &&
        (!Number.isInteger(offset) || Math.abs(offset) > 525600)
      )
        throw new Error("Choose an offset within one year.");
      if (
        when !== "now" &&
        (scheduledAt === null ||
          !Number.isFinite(scheduledAt) ||
          scheduledAt <= Date.now())
      )
        throw new Error("Choose a future time.");
      const key = JSON.stringify([
        worldId,
        access,
        region,
        ageGated,
        queueEnabled,
        restricted,
        roleIds,
        eventId,
        when,
        fixedAt,
        offsetMinutes,
      ]);
      if (retry.current?.key !== key)
        retry.current = {
          key,
          payload: {
            kind: "create_instance",
            worldId: worldId.trim(),
            access,
            region,
            ageGated,
            queueEnabled,
            ...(restricted ? { roleIds } : {}),
          },
          schedule:
            when === "event_relative"
              ? {
                  kind: "event_relative",
                  eventId: selected!.id,
                  offsetMs: offset * 60_000,
                }
              : when === "now"
                ? {
                    kind: "immediate",
                    ...(selected ? { eventId: selected.id } : {}),
                  }
                : {
                    kind: "fixed",
                    dueAt: new Date(fixedAt).getTime(),
                    ...(selected ? { eventId: selected.id } : {}),
                  },
        };
      setPending(true);
      await onSubmit(retry.current.payload, retry.current.schedule);
      retry.current = null;
      setMessage(when === "now" ? "Creation queued." : "Creation scheduled.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create instance.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field>
        VRChat world ID
        <Input
          value={worldId}
          onChange={(event) => setWorldId(event.target.value)}
          placeholder="wrld_…"
          required
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          Access
          <Select
            value={access}
            onChange={(event) => {
              setAccess(event.target.value as CreatePayload["access"]);
              setRestricted(false);
              setRoleIds([]);
            }}
          >
            <option value="members">Group members</option>
            <option value="plus">Group+</option>
            <option value="public">Group public</option>
          </Select>
        </Field>
        <Field>
          Region
          <Select
            value={region}
            onChange={(event) =>
              setRegion(event.target.value as CreatePayload["region"])
            }
          >
            <option value="us">US West</option>
            <option value="use">US East</option>
            <option value="eu">Europe</option>
            <option value="jp">Japan</option>
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-3">
        <CheckboxField
          checked={ageGated}
          onChange={(event) => setAgeGated(event.target.checked)}
        >
          18+
        </CheckboxField>
        <CheckboxField
          checked={queueEnabled}
          onChange={(event) => setQueueEnabled(event.target.checked)}
        >
          Enable queue
        </CheckboxField>
        {access === "members" ? (
          <CheckboxField
            checked={restricted}
            onChange={(event) => {
              setRestricted(event.target.checked);
              if (event.target.checked) onLoadRoles();
            }}
          >
            Restrict to group roles
          </CheckboxField>
        ) : null}
      </div>
      {restricted ? (
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">
            Allowed group roles
          </legend>
          {roles.map((role) => (
            <CheckboxField
              key={role.id}
              checked={roleIds.includes(role.id)}
              onChange={(event) =>
                setRoleIds((current) =>
                  event.target.checked
                    ? [...current, role.id]
                    : current.filter((id) => id !== role.id),
                )
              }
            >
              {role.name ?? role.id}
            </CheckboxField>
          ))}
          {!rolesReady ? (
            <Notice>Loading group roles…</Notice>
          ) : roles.length === 0 ? (
            <Notice>No group roles available.</Notice>
          ) : null}
        </fieldset>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          Linked event
          <Select
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
          >
            <option value="">Standalone instance</option>
            {events
              .filter((event) => event.status !== "cancelled")
              .map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
          </Select>
        </Field>
        <Field>
          Create
          <Select
            value={when}
            onChange={(event) => setWhen(event.target.value as typeof when)}
          >
            <option value="now">Now</option>
            <option value="fixed">At a specific time</option>
            <option value="event_relative">Relative to event start</option>
          </Select>
        </Field>
      </div>
      {when === "fixed" ? (
        <Field>
          Creation time
          <Input
            type="datetime-local"
            required
            value={fixedAt}
            onChange={(event) => setFixedAt(event.target.value)}
          />
        </Field>
      ) : null}
      {when === "event_relative" ? (
        <Field>
          Minutes from event start
          <Input
            type="number"
            min={-525600}
            max={525600}
            step={1}
            value={offsetMinutes}
            onChange={(event) => setOffsetMinutes(event.target.value)}
          />
          <span className="text-xs text-muted">
            Negative values create the instance before the event.
          </span>
        </Field>
      ) : null}
      {selected ? (
        <p className="text-sm text-muted">
          {selected.title} · {metricTime(selected.startAt)}
        </p>
      ) : null}
      {scheduledAt !== null && Number.isFinite(scheduledAt) ? (
        <p className="text-sm" data-testid="instance-scheduled-time">
          Scheduled for{" "}
          <time dateTime={new Date(scheduledAt).toISOString()}>
            {metricTime(scheduledAt)}
          </time>
        </p>
      ) : null}
      {error ? (
        <Notice variant="error" role="alert">
          {error}
        </Notice>
      ) : null}
      {message ? <Notice role="status">{message}</Notice> : null}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending
          ? "Submitting…"
          : when === "now"
            ? "Create instance"
            : "Schedule instance"}
      </Button>
    </form>
  );
}

function LiveInstanceManagement({
  communityProfileId,
}: {
  communityProfileId: Id<"profiles">;
}) {
  const [offset, setOffset] = useState(0);
  const instances = useClubProviderRead(communityProfileId, {
    kind: "instances",
    n: 100,
    offset,
  });
  return (
    <section className="grid gap-3" aria-label="Live instances">
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={instances.loading}
          onClick={instances.refresh}
        >
          Refresh instances
        </Button>
      </div>
      {instances.error ? (
        <Notice variant="error" role="alert">
          {instances.error}
        </Notice>
      ) : null}
      {instances.loading ? (
        <Notice role="status">Loading instances…</Notice>
      ) : null}
      {instances.data?.items.map((instance) => (
        <div
          key={JSON.stringify([
            instance.id,
            instance.worldId,
            instance.instanceId,
          ])}
          className="min-w-0 border-t border-border pt-3"
        >
          <p className="text-sm font-medium">
            {instance.name ?? "VRChat instance"}
          </p>
          <p className="mt-1 break-all text-xs text-muted">
            {instance.worldId}
          </p>
          <p className="mt-1 break-all text-xs text-muted">
            {instance.instanceId}
          </p>
          {instance.worldId && instance.instanceId ? (
            <CloseInstanceAction
              worldId={instance.worldId}
              instanceId={instance.instanceId}
            />
          ) : null}
        </div>
      ))}
      <div className="flex flex-wrap gap-3">
        {offset > 0 ? (
          <Button
            disabled={instances.loading}
            onClick={() => setOffset(Math.max(0, offset - 100))}
          >
            Previous instances
          </Button>
        ) : null}
        {instances.data?.nextOffset != null ? (
          <Button
            disabled={instances.loading}
            onClick={() => setOffset(instances.data!.nextOffset!)}
          >
            Next instances
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function InstanceOperations() {
  const workspace = useClubWorkspace();
  const communityProfileId = workspace.community._id;
  const context = useQuery(api.clubProviderReads.context, {
    communityProfileId,
  });
  const events = usePaginatedQuery(
    api.clubProviderReads.listEvents,
    { communityProfileId },
    { initialNumItems: 50 },
  );
  const jobs = usePaginatedQuery(
    api.clubOperations.list,
    { communityProfileId },
    { initialNumItems: 25 },
  );
  const enqueue = useMutation(api.clubOperations.enqueue),
    cancel = useMutation(api.clubOperations.cancel);
  const [showCreate, setShowCreate] = useState(false),
    [loadRoles, setLoadRoles] = useState(false),
    [error, setError] = useState("");
  const retry = useRef<{ key: string; requestId: string } | null>(null);
  const enabled = context?.enabledFeatures.includes("instances") ?? false;
  const roles = useClubProviderRead(
    communityProfileId,
    enabled && loadRoles ? { kind: "instance_roles", n: 100, offset: 0 } : null,
  );
  if (context === undefined) return <Notice>Loading instance controls…</Notice>;
  if (!enabled) return <Notice>Instance management is disabled.</Notice>;
  return (
    <Card padding="lg" className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>Instance management</SectionTitle>
        <Button onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Hide form" : "New instance"}
        </Button>
      </div>
      <LiveInstanceManagement communityProfileId={communityProfileId} />
      {showCreate ? (
        <>
          <InstanceCreateForm
            events={events.results}
            roles={roles.data?.items ?? []}
            rolesReady={!!roles.data && roles.fresh}
            onLoadRoles={() => setLoadRoles(true)}
            onSubmit={async (payload, schedule) => {
              const key = JSON.stringify([payload, schedule]);
              if (retry.current?.key !== key)
                retry.current = { key, requestId: crypto.randomUUID() };
              await enqueue({
                communityProfileId,
                requestId: retry.current.requestId,
                payloads: [payload],
                schedule,
              });
              retry.current = null;
            }}
          />
          {roles.error || (loadRoles && roles.data && !roles.fresh) ? (
            <Notice variant={roles.error ? "error" : "warning"}>
              {roles.error ?? "Refresh group roles to continue."}
              <Button onClick={roles.refresh}>Refresh roles</Button>
            </Notice>
          ) : null}
          {events.status === "CanLoadMore" ? (
            <Button onClick={() => events.loadMore(50)}>
              Load more events
            </Button>
          ) : null}
        </>
      ) : null}
      {error ? (
        <Notice variant="error" role="alert">
          {error}
        </Notice>
      ) : null}
      <div className="grid gap-3">
        {jobs.results
          .filter(
            (job) =>
              job.payload.kind === "create_instance" ||
              job.payload.kind === "close_instance",
          )
          .map((job) => (
            <div
              key={job.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"
            >
              <div>
                <p className="text-sm font-medium">
                  {job.payload.kind === "create_instance"
                    ? "Create instance"
                    : "Close instance"}
                </p>
                <p className="text-xs text-muted">
                  {metricTime(job.dueAt)} ·{" "}
                  {job.state === "indeterminate"
                    ? "Outcome unknown"
                    : job.state === "pending"
                      ? "Queued"
                      : job.state.replaceAll("_", " ")}
                </p>
              </div>
              {["pending", "claimed"].includes(job.state) &&
              (workspace.actor.kind === "owner" ||
                workspace.actor.permissions.includes(
                  "manage_scheduled_actions",
                ) ||
                job.actor.tokenIdentifier ===
                  workspace.actor.subject?.tokenIdentifier) ? (
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await cancel({ operationId: job.id });
                    } catch {
                      setError("Unable to cancel action.");
                    }
                  }}
                >
                  Cancel action
                </Button>
              ) : null}
            </div>
          ))}
      </div>
      {jobs.status === "CanLoadMore" ? (
        <Button onClick={() => jobs.loadMore(25)}>Load more actions</Button>
      ) : null}
    </Card>
  );
}
export function ClubInstanceActions() {
  const { actor } = useClubWorkspace();
  return actor.kind === "owner" ||
    actor.permissions.includes("manage_instances") ? (
    <InstanceOperations />
  ) : null;
}
export function CloseInstanceAction({
  worldId,
  instanceId,
}: {
  worldId: string;
  instanceId: string;
}) {
  const workspace = useClubWorkspace();
  const permitted =
    workspace.actor.kind === "owner" ||
    workspace.actor.permissions.includes("manage_instances");
  const context = useQuery(
    api.clubProviderReads.context,
    permitted ? { communityProfileId: workspace.community._id } : "skip",
  );
  const enqueue = useMutation(api.clubOperations.enqueue);
  const [confirm, setConfirm] = useState(false),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  const retry = useRef<Submission | null>(null);
  if (!permitted || !context?.enabledFeatures.includes("instances"))
    return null;
  return (
    <div className="mt-5 grid justify-items-start gap-3">
      {message ? <Notice role="status">{message}</Notice> : null}
      {confirm ? (
        <>
          <p className="text-sm">Close this instance to prevent new joins?</p>
          <div className="flex gap-3">
            <Button
              disabled={pending}
              onClick={async () => {
                setPending(true);
                try {
                  retry.current ??= {
                    communityProfileId: workspace.community._id,
                    requestId: crypto.randomUUID(),
                    payloads: [{ kind: "close_instance", worldId, instanceId }],
                    schedule: { kind: "immediate" },
                  };
                  await enqueue(retry.current);
                  retry.current = null;
                  setMessage("Closure queued.");
                  setConfirm(false);
                } catch {
                  setMessage("Unable to queue closure. Try again.");
                } finally {
                  setPending(false);
                }
              }}
            >
              Confirm closure
            </Button>
            <Button disabled={pending} onClick={() => setConfirm(false)}>
              Keep open
            </Button>
          </div>
        </>
      ) : (
        <Button onClick={() => setConfirm(true)}>Close instance</Button>
      )}
    </div>
  );
}
