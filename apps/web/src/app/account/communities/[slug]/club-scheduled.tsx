"use client";

import { useState } from "react";
import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType, FunctionArgs } from "convex/server";
import { api } from "@convex-generated-api";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import {
  CheckboxField,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { ClubNotifications } from "./club-notifications";
import { useClubWorkspace } from "./club-workspace";
import { metricTime } from "./club-chart";
import { useClubProviderRead, type ProviderItem } from "./club-provider-read";
import {
  canEditOperation,
  localDateTime,
  operationLabels,
  operationReason,
  type ClubOperationPayload,
} from "./club-operation-model";
import type { Id } from "../../../../../../../convex/_generated/dataModel";

type Operation = FunctionReturnType<
  typeof api.clubOperations.list
>["page"][number];
type Schedule = FunctionArgs<typeof api.clubOperations.edit>["schedule"];
const statusLabels = {
  pending: "Pending",
  claimed: "Preparing",
  submitted: "Submitted",
  succeeded: "Completed",
  rejected: "Failed",
  indeterminate: "Outcome unknown",
  cancelled: "Cancelled",
  missed: "Missed",
};

function PayloadFields({
  payload,
  setPayload,
  roleOptions,
}: {
  payload: ClubOperationPayload;
  setPayload: (value: ClubOperationPayload) => void;
  roleOptions: ProviderItem[];
}) {
  return (
    <>
      {"targetUserId" in payload ? (
        <Field>
          Recipient VRChat user ID
          <Input
            required
            value={payload.targetUserId}
            onChange={(event) =>
              setPayload({ ...payload, targetUserId: event.target.value })
            }
          />
        </Field>
      ) : null}
      {"roleId" in payload ? (
        <Field>
          VRChat role
          <Select
            aria-label="VRChat role"
            required
            value={roleOptions.find(role => role.id.toLowerCase() === payload.roleId.toLowerCase())?.id ?? payload.roleId}
            onChange={(event) =>
              setPayload({ ...payload, roleId: event.target.value })
            }
          >
            <option value="">Select role</option>
            {roleOptions.map((role) => (
              <option value={role.id} key={role.id}>
                {role.name ?? role.id}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {"title" in payload ? (
        <>
          <Field>
            Title
            <Input
              required
              maxLength={200}
              value={payload.title}
              onChange={(event) =>
                setPayload({ ...payload, title: event.target.value })
              }
            />
          </Field>
          <Field>
            Post
            <Textarea
              required
              rows={6}
              maxLength={10000}
              value={payload.text}
              onChange={(event) =>
                setPayload({ ...payload, text: event.target.value })
              }
            />
          </Field>
          <Field>
            Visibility
            <Select
              aria-label="Visibility"
              value={payload.visibility}
              onChange={(event) =>
                setPayload({
                  ...payload,
                  visibility: event.target.value as "public" | "group",
                })
              }
            >
              <option value="group">Group</option>
              <option value="public">Public</option>
            </Select>
          </Field>
          <CheckboxField
            checked={payload.sendNotification}
            onChange={(event) =>
              setPayload({ ...payload, sendNotification: event.target.checked })
            }
          >
            Send notification
          </CheckboxField>
          <Field>
            Image ID
            <Input
              value={payload.imageId ?? ""}
              onChange={(event) =>
                setPayload({
                  ...payload,
                  imageId: event.target.value || undefined,
                })
              }
            />
          </Field>
          <Field>
            VRChat role IDs
            <Input
              value={payload.roleIds?.join(", ") ?? ""}
              onChange={(event) =>
                setPayload({
                  ...payload,
                  roleIds: event.target.value.split(/[\s,]+/).filter(Boolean),
                })
              }
            />
          </Field>
        </>
      ) : null}
      {"postId" in payload ? (
        <Field>
          Post ID
          <Input
            required
            value={payload.postId}
            onChange={(event) =>
              setPayload({ ...payload, postId: event.target.value })
            }
          />
        </Field>
      ) : null}
      {"worldId" in payload ? (
        <Field>
          World ID
          <Input
            required
            value={payload.worldId}
            onChange={(event) =>
              setPayload({ ...payload, worldId: event.target.value })
            }
          />
        </Field>
      ) : null}
      {"instanceId" in payload ? (
        <Field>
          Instance ID
          <Input
            required
            value={payload.instanceId}
            onChange={(event) =>
              setPayload({ ...payload, instanceId: event.target.value })
            }
          />
        </Field>
      ) : null}
      {payload.kind === "create_instance" ? (
        <>
          <Field>
            Access
            <Select
              aria-label="Access"
              value={payload.access}
              onChange={(event) =>
                setPayload({
                  ...payload,
                  access: event.target.value as typeof payload.access,
                })
              }
            >
              <option value="members">Members</option>
              <option value="plus">Group plus</option>
              <option value="public">Public</option>
            </Select>
          </Field>
          <Field>
            Region
            <Select
              aria-label="Region"
              value={payload.region}
              onChange={(event) =>
                setPayload({
                  ...payload,
                  region: event.target.value as typeof payload.region,
                })
              }
            >
              <option value="us">US West</option>
              <option value="use">US East</option>
              <option value="eu">Europe</option>
              <option value="jp">Japan</option>
            </Select>
          </Field>
          <CheckboxField
            checked={payload.ageGated ?? false}
            onChange={(event) =>
              setPayload({ ...payload, ageGated: event.target.checked })
            }
          >
            18+
          </CheckboxField>
          <CheckboxField
            checked={payload.queueEnabled ?? false}
            onChange={(event) =>
              setPayload({ ...payload, queueEnabled: event.target.checked })
            }
          >
            Queue enabled
          </CheckboxField>
          <Field>
            VRChat role IDs
            <Input
              value={payload.roleIds?.join(", ") ?? ""}
              onChange={(event) =>
                setPayload({
                  ...payload,
                  roleIds: event.target.value.split(/[\s,]+/).filter(Boolean),
                })
              }
            />
          </Field>
          <Field>
            VRChat calendar entry ID
            <Input
              value={payload.calendarEntryId ?? ""}
              onChange={(event) =>
                setPayload({
                  ...payload,
                  calendarEntryId: event.target.value || undefined,
                })
              }
            />
          </Field>
        </>
      ) : null}
      {payload.kind === "invite_to_instance" ? (
        <Field>
          Message slot
          <Input
            type="number"
            min={0}
            max={11}
            value={payload.messageSlot ?? 0}
            onChange={(event) =>
              setPayload({
                ...payload,
                messageSlot: Number(event.target.value),
              })
            }
          />
        </Field>
      ) : null}
    </>
  );
}

function OperationEditor({
  operation,
  onClose,
}: {
  operation: Operation;
  onClose: () => void;
}) {
  const workspace = useClubWorkspace();
  const [payload, setPayload] = useState(operation.payload);
  const [expectedRevision] = useState(operation.revision);
  const [scheduleKind, setScheduleKind] = useState(operation.schedule.kind);
  const [dueAt, setDueAt] = useState(localDateTime(operation.dueAt));
  const [eventId, setEventId] = useState(operation.schedule.eventId ?? "");
  const [offsetMinutes, setOffsetMinutes] = useState(
    operation.schedule.kind === "event_relative"
      ? operation.schedule.offsetMs / 60_000
      : 0,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useConvex();
  const save = useMutation(api.clubOperations.edit);
  const isRoleEdit = "roleId" in payload;
  const [roleOffset, setRoleOffset] = useState(0);
  const roleContext = useQuery(
    api.clubProviderReads.context,
    isRoleEdit ? { communityProfileId: workspace.community._id } : "skip",
  );
  const roles = useClubProviderRead(
    workspace.community._id,
    isRoleEdit ? { kind: "roles", n: 100, offset: roleOffset } : null,
  );
  const roleOptions =
    roles.data?.items.filter(
      (role) =>
        workspace.actor.kind === "owner" ||
        roleContext?.permittedProviderRoleIds.some(id => id.toLowerCase() === role.id.toLowerCase()),
    ) ?? [];
  const invalidRole =
    isRoleEdit &&
    (!roles.fresh || !roleOptions.some((role) => role.id.toLowerCase() === payload.roleId.toLowerCase()));
  const events = usePaginatedQuery(
    api.clubProviderReads.listEvents,
    { communityProfileId: workspace.community._id },
    { initialNumItems: 25 },
  );
  const eventItems = events.results.filter(
    (event) => event.status !== "cancelled",
  );
  return (
    <Card padding="lg">
      <SectionTitle>
        Edit {operationLabels[payload.kind].toLowerCase()}
      </SectionTitle>
      <form
        className="mt-5 grid gap-5"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          const schedule: Schedule =
            scheduleKind === "immediate"
              ? {
                  kind: "immediate",
                  ...(eventId ? { eventId: eventId as Id<"events"> } : {}),
                }
              : scheduleKind === "fixed"
              ? {
                  kind: "fixed",
                  dueAt: new Date(dueAt).getTime(),
                  ...(eventId ? { eventId: eventId as Id<"events"> } : {}),
                }
              : {
                  kind: "event_relative",
                  eventId: eventId as Id<"events">,
                  offsetMs: offsetMinutes * 60_000,
                };
          setBusy(true);
          try {
            let reviewedDueAt: number | undefined;
            if (schedule.kind !== "immediate") {
              const serverNow = await client.query(api.clubOperations.getScheduleClock, {
                freshnessNonce: crypto.randomUUID(),
              });
              const scheduledEvent = schedule.kind === "event_relative"
                ? eventItems.find((item) => item.id === schedule.eventId)
                : null;
              const scheduledAt = schedule.kind === "fixed"
                ? schedule.dueAt
                : scheduledEvent
                  ? scheduledEvent.startAt + schedule.offsetMs
                  : NaN;
              if (!Number.isFinite(scheduledAt) || scheduledAt <= serverNow)
                throw new Error("Choose a future time.");
              if (schedule.kind === "event_relative")
                reviewedDueAt = scheduledAt;
            }
            await save({
              operationId: operation.id,
              expectedRevision,
              payload: "roleId" in payload
                ? { ...payload, roleId: roleOptions.find(role => role.id.toLowerCase() === payload.roleId.toLowerCase())?.id ?? payload.roleId }
                : payload,
              schedule,
              reviewedDueAt,
            });
            onClose();
          } catch (cause) {
            setError(
              cause instanceof Error ? cause.message : "Unable to save action.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <PayloadFields
          payload={payload}
          setPayload={setPayload}
          roleOptions={roleOptions}
        />
        {isRoleEdit ? (
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={roles.refresh}>
              Refresh roles
            </Button>
            {roles.data?.nextOffset != null ? (
              <Button
                type="button"
                onClick={() => setRoleOffset(roles.data!.nextOffset!)}
              >
                More roles
              </Button>
            ) : null}
            {roleOffset > 0 ? (
              <Button type="button" onClick={() => setRoleOffset(0)}>
                First roles
              </Button>
            ) : null}
            {roles.error ? (
              <Notice variant="error">{roles.error}</Notice>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field>
            Timing
            <Select
              aria-label="Timing"
              value={scheduleKind}
              onChange={(event) =>
                setScheduleKind(event.target.value as typeof scheduleKind)
              }
            >
              <option value="immediate">Now</option>
              <option value="fixed">Fixed time</option>
              <option value="event_relative">Relative to event</option>
            </Select>
          </Field>
          <Field>
            Event
            <Select
              aria-label="Event"
              required={scheduleKind === "event_relative"}
              value={eventId}
              onChange={(event) => setEventId(event.target.value)}
            >
              <option value="">No event</option>
              {eventId && !eventItems.some((event) => event.id === eventId) ? (
                <option value={eventId}>Current linked event</option>
              ) : null}
              {eventItems.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
            </Select>
          </Field>
          {scheduleKind === "fixed" ? (
            <Field>
              Execution time
              <Input
                type="datetime-local"
                required
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </Field>
          ) : scheduleKind === "event_relative" ? (
            <Field>
              Minutes after event start
              <Input
                type="number"
                required
                step="1"
                min={-525600}
                max={525600}
                value={offsetMinutes}
                onChange={(event) =>
                  setOffsetMinutes(Number(event.target.value))
                }
              />
            </Field>
          ) : null}
        </div>
        {events.status === "CanLoadMore" ? (
          <Button type="button" onClick={() => events.loadMore(25)}>
            More events
          </Button>
        ) : null}
        {error ? (
          <Notice variant="error" role="alert">
            {error}
          </Notice>
        ) : null}
        <div className="flex gap-3">
          <Button
            type="submit"
            variant="primary"
            disabled={busy || invalidRole}
          >
            Save action
          </Button>
          <Button type="button" disabled={busy} onClick={onClose}>
            Cancel edit
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function ClubScheduled() {
  const workspace = useClubWorkspace();
  const operations = usePaginatedQuery(
    api.clubOperations.list,
    { communityProfileId: workspace.community._id },
    { initialNumItems: 25 },
  );
  const cancel = useMutation(api.clubOperations.cancel);
  const [editing, setEditing] = useState<Operation | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<Operation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"all" | "pending" | "history">("all");
  const visible = operations.results.filter(
    (operation) =>
      view === "all" ||
      (view === "pending"
        ? ["pending", "claimed", "submitted"].includes(operation.state)
        : !["pending", "claimed", "submitted"].includes(operation.state)),
  );
  return (
    <div className="grid gap-6">
      <h1 className="text-3xl font-semibold">Scheduled actions</h1>
      <ClubNotifications />
      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label="Action history"
      >
        {(["all", "pending", "history"] as const).map((value) => (
          <Button
            key={value}
            role="tab"
            aria-selected={view === value}
            onClick={() => setView(value)}
          >
            {value === "all"
              ? "All actions"
              : value === "pending"
                ? "Pending"
                : "History"}
          </Button>
        ))}
      </div>
      {error ? (
        <Notice variant="error" role="alert">
          {error}
        </Notice>
      ) : null}
      {editing &&
      canEditOperation(
        workspace.actor,
        editing.payload,
        editing.actor.tokenIdentifier,
      ) &&
      operations.results.some(
        (operation) =>
          operation.id === editing.id && operation.state === "pending",
      ) ? (
        <OperationEditor
          key={editing.id}
          operation={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {confirmCancel &&
      canEditOperation(
        workspace.actor,
        confirmCancel.payload,
        confirmCancel.actor.tokenIdentifier,
      ) &&
      operations.results.some(
        (operation) =>
          operation.id === confirmCancel.id &&
          ["pending", "claimed"].includes(operation.state),
      ) ? (
        <Card padding="lg">
          <SectionTitle>Cancel action?</SectionTitle>
          <p className="mt-3">{operationLabels[confirmCancel.payload.kind]}</p>
          {"targetUserId" in confirmCancel.payload ? (
            <p className="mt-2 break-all text-xs text-muted">
              {confirmCancel.payload.targetUserId}
            </p>
          ) : null}
          <div className="mt-5 flex gap-3">
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await cancel({ operationId: confirmCancel.id });
                  setConfirmCancel(null);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Unable to cancel action.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm cancellation
            </Button>
            <Button disabled={busy} onClick={() => setConfirmCancel(null)}>
              Keep action
            </Button>
          </div>
        </Card>
      ) : null}
      <Card padding="lg">
        <div className="divide-y divide-border">
          {visible.map((operation) => (
            <div
              key={operation.id}
              className="flex flex-wrap items-start justify-between gap-5 py-5"
            >
              <div className="min-w-0">
                <h2 className="font-semibold">
                  {operationLabels[operation.payload.kind]}
                </h2>
                {"title" in operation.payload ? (
                  <p className="mt-1 text-sm">{operation.payload.title}</p>
                ) : null}
                {"targetUserId" in operation.payload ? (
                  <p className="mt-1 break-all text-xs text-muted">
                    {operation.payload.targetUserId}
                  </p>
                ) : null}
                {"worldId" in operation.payload ? (
                  <p className="mt-1 break-all text-xs text-muted">
                    {operation.payload.worldId}
                  </p>
                ) : null}
                <p className="mt-2 text-sm">{metricTime(operation.dueAt)}</p>
                {operation.schedule.kind === "event_relative" ? (
                  <p className="mt-1 text-xs text-muted">
                    {operation.schedule.offsetMs / 60_000} minutes after event
                    start
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted">
                  {operation.actor.displayName ?? "Staff"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm">{statusLabels[operation.state]}</span>
                {operationReason(operation.code) ? (
                  <span className="text-xs text-muted">
                    {operationReason(operation.code)}
                  </span>
                ) : null}
                {canEditOperation(
                  workspace.actor,
                  operation.payload,
                  operation.actor.tokenIdentifier,
                ) ? (
                  <>
                    {operation.state === "pending" ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditing(operation);
                          setConfirmCancel(null);
                        }}
                      >
                        Edit action
                      </Button>
                    ) : null}
                    {operation.state === "pending" ||
                    operation.state === "claimed" ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          setConfirmCancel(operation);
                          setEditing(null);
                        }}
                      >
                        Cancel action
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {operations.status === "LoadingFirstPage" ? (
          <Notice role="status">Loading actions…</Notice>
        ) : visible.length === 0 ? (
          <Notice variant="dashed">No actions in this view.</Notice>
        ) : null}
        {operations.status === "CanLoadMore" ? (
          <Button className="mt-5" onClick={() => operations.loadMore(25)}>
            More actions
          </Button>
        ) : null}
      </Card>
    </div>
  );
}
