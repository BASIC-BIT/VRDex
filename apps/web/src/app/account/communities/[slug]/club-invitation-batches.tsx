"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  useConvex,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@convex-generated-api";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { ClubAccessNotice, useClubWorkspace } from "./club-workspace";
import { useClubProviderRead, type ProviderItem } from "./club-provider-read";
import { metricTime } from "./club-chart";
import { operationReason } from "./club-operation-model";
import type { Id } from "../../../../../../../convex/_generated/dataModel";

type Enqueue = FunctionArgs<typeof api.clubInvitations.enqueue>;
type RecipientList = FunctionReturnType<
  typeof api.clubInvitations.lists
>["page"][number];
type Event = FunctionReturnType<
  typeof api.clubProviderReads.listEvents
>["page"][number];
type Operation = FunctionReturnType<
  typeof api.clubOperations.list
>["page"][number];
type Preview = FunctionReturnType<typeof api.clubInvitations.preview>;
type Review = Pick<
  Enqueue,
  "reviewedRecipients" | "destination" | "schedule" | "requestId"
> & { destinationLabel: string; timeLabel: string; duplicates: number };

export function InvitationComposer({
  lists,
  events,
  instances,
  instancesFresh,
  creations,
  canGroup,
  canInstance,
  botUrl,
  onPreview,
  onEnqueue,
  onSaveList,
  onRemoveList,
  recipientEligibility,
  moreLists,
  moreEvents,
  moreCreations,
  instanceControls,
}: {
  lists: RecipientList[];
  events: Event[];
  instances: ProviderItem[];
  instancesFresh: boolean;
  creations: Operation[];
  canGroup: boolean;
  canInstance: boolean;
  botUrl?: string;
  onPreview: (recipients: string[]) => Promise<Preview>;
  onEnqueue: (review: Review) => Promise<void>;
  onSaveList: (list: {
    name: string;
    recipients: string[];
    listId?: Id<"clubRecipientLists">;
    expectedRevision?: number;
  }) => Promise<void>;
  onRemoveList: (id: Id<"clubRecipientLists">) => Promise<void>;
  recipientEligibility?: (
    userId: string,
    destination: Enqueue["destination"],
  ) => ReactNode;
  moreLists?: ReactNode;
  moreEvents?: ReactNode;
  moreCreations?: ReactNode;
  instanceControls?: ReactNode;
}) {
  const [text, setText] = useState(""),
    [name, setName] = useState(""),
    [editing, setEditing] = useState<RecipientList | null>(null);
  const [destination, setDestination] = useState(
      canGroup ? "group" : "instance",
    ),
    [instanceId, setInstanceId] = useState(""),
    [creationId, setCreationId] = useState("");
  const [timing, setTiming] = useState("now"),
    [date, setDate] = useState(""),
    [eventId, setEventId] = useState(""),
    [offset, setOffset] = useState("0");
  const [review, setReview] = useState<Review | null>(null),
    [deleting, setDeleting] = useState<RecipientList | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const recipients = () => text.split(/[\s,;]+/).filter(Boolean);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save invitations.",
      );
    } finally {
      setBusy(false);
    }
  };
  const prepare = async () => {
    const normalized = await onPreview(recipients());
    let target: Enqueue["destination"];
    let destinationLabel: string;
    if (destination === "group" && canGroup) {
      target = { kind: "group" };
      destinationLabel = "Primary group";
    } else if (destination === "instance" && canInstance) {
      if (!instancesFresh) throw new Error("Instance unavailable.");
      const instance = instances.find((item) => item.id === instanceId);
      if (!instance?.worldId || !instance.instanceId)
        throw new Error("Choose an instance.");
      target = {
        kind: "instance",
        worldId: instance.worldId,
        instanceId: instance.instanceId,
      };
      destinationLabel = `${instance.name || "Instance"}: ${instance.worldId}:${instance.instanceId}`;
    } else if (destination === "scheduled_instance" && canInstance) {
      const creation = creations.find((item) => item.id === creationId);
      if (
        !creation ||
        creation.payload.kind !== "create_instance" ||
        !["pending", "claimed", "submitted", "succeeded"].includes(
          creation.state,
        )
      )
        throw new Error("Choose an instance creation.");
      target = {
        kind: "scheduled_instance",
        creationOperationId: creation.id,
        creationRevision: creation.revision,
      };
      destinationLabel = `Instance creation: ${metricTime(creation.dueAt)} · ${creation.payload.worldId}`;
    } else throw new Error("Choose an invitation destination.");
    let schedule: Enqueue["schedule"];
    let timeLabel: string;
    if (timing === "event") {
      const event = events.find((item) => item.id === eventId);
      const minutes = Number(offset);
      if (
        !event ||
        event.status === "cancelled" ||
        !offset.trim() ||
        !Number.isFinite(minutes)
      )
        throw new Error("Choose an event and a valid offset.");
      if (event.startAt + minutes * 60000 <= Date.now())
        throw new Error("Choose a future invitation time.");
      schedule = {
        kind: "event_relative",
        eventId: event.id,
        offsetMs: minutes * 60000,
      };
      timeLabel = `${event.title}: ${metricTime(event.startAt + minutes * 60000)} (${minutes} minutes from start)`;
    } else if (timing === "now") {
      schedule = { kind: "immediate" };
      timeLabel = "Now";
    } else {
      const dueAt = new Date(date).getTime();
      if (!Number.isFinite(dueAt) || dueAt <= Date.now())
        throw new Error("Choose a future invitation time.");
      schedule = { kind: "fixed", dueAt };
      timeLabel = metricTime(dueAt);
    }
    if (target.kind === "scheduled_instance" && schedule.kind !== "immediate") {
      const creation = creations.find(
        (item) => item.id === target.creationOperationId,
      )!;
      const dueAt =
        schedule.kind === "fixed"
          ? schedule.dueAt
          : events.find((item) => item.id === schedule.eventId)!.startAt +
            schedule.offsetMs;
      if (dueAt < creation.dueAt)
        throw new Error(
          "Invitation time must be at or after instance creation.",
        );
    }
    setReview({
      reviewedRecipients: normalized.recipients,
      destination: target,
      destinationLabel,
      schedule,
      timeLabel,
      duplicates: normalized.removedDuplicates,
      requestId: crypto.randomUUID(),
    });
  };
  const reviewedInstance = review?.destination.kind === "instance" ? review.destination : null;
  const reviewedInstanceUnavailable = reviewedInstance !== null &&
    (!instancesFresh || !instances.some(item =>
      item.worldId === reviewedInstance.worldId &&
      item.instanceId === reviewedInstance.instanceId));
  useEffect(() => {
    if (instanceId && (!instancesFresh || reviewedInstanceUnavailable ||
      !instances.some(item => item.id === instanceId)))
      setInstanceId("");
    if (reviewedInstanceUnavailable) setReview(null);
  }, [instanceId, instances, instancesFresh, reviewedInstanceUnavailable]);
  return (
    <div className="grid gap-6">
      {error ? (
        <Notice variant="error" role="alert">
          {error}
        </Notice>
      ) : null}
      {notice ? <Notice role="status">{notice}</Notice> : null}
      {review ? (
        <Card padding="lg">
          <section aria-label="Review invitations" className="grid gap-5">
            <SectionTitle>Review invitations</SectionTitle>
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-muted">Recipients</dt>
                <dd className="text-2xl font-semibold">
                  {review.reviewedRecipients.length}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Destination</dt>
                <dd className="break-words">{review.destinationLabel}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Send</dt>
                <dd>{review.timeLabel}</dd>
              </div>
            </dl>
            {review.duplicates ? (
              <p className="text-sm text-muted">
                Duplicates removed: {review.duplicates}
              </p>
            ) : null}
            <p className="text-sm text-muted">
              Eligibility is checked when each invitation is sent.
            </p>
            {review.destination.kind === "scheduled_instance" ? (
              <p className="text-sm text-muted">
                Invitations wait for this instance creation to succeed.
              </p>
            ) : null}
            {reviewedInstanceUnavailable ? (
              <Notice>Instance unavailable.</Notice>
            ) : null}
            {review.destination.kind !== "group" && botUrl ? (
              <a
                className="w-fit text-sm underline"
                href={botUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open assigned bot in VRChat
              </a>
            ) : null}
            <ul
              aria-label="Reviewed recipients"
              className="max-h-96 overflow-y-auto divide-y divide-border"
            >
              {review.reviewedRecipients.map((id) => (
                <li className="py-3" key={id}>
                  <p className="break-all font-mono text-xs">{id}</p>
                  {recipientEligibility?.(id, review.destination)}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={busy || !!reviewedInstanceUnavailable}
                onClick={() =>
                  void run(async () => {
                    await onEnqueue(review);
                    setReview(null);
                    setNotice("Invitations queued.");
                  })
                }
              >
                Confirm invitations
              </Button>
              <Button disabled={busy} onClick={() => setReview(null)}>
                Back to edit
              </Button>
            </div>
          </section>
        </Card>
      ) : (
        <>
          <Card padding="lg">
            <div className="grid gap-5">
              <SectionTitle>Recipients</SectionTitle>
              <Field>
                Saved list
                <Select
                  value={editing?._id ?? ""}
                  disabled={busy}
                  onChange={(event) => {
                    const list = lists.find(
                      (item) => item._id === event.target.value,
                    );
                    setEditing(list ?? null);
                    setName(list?.name ?? "");
                    setText(list?.recipients.join("\n") ?? "");
                  }}
                >
                  <option value="">New list</option>
                  {lists.map((list) => (
                    <option key={list._id} value={list._id}>
                      {list.name} ({list.recipients.length})
                    </option>
                  ))}
                </Select>
              </Field>
              {moreLists}
              <Field>
                VRChat user IDs
                <Textarea
                  rows={5}
                  value={text}
                  disabled={busy}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="usr_…"
                />
              </Field>
              <p className="text-sm text-muted">
                Up to 100 entries, separated by spaces, commas, or new lines.
              </p>
              <Field>
                List name
                <Input
                  value={name}
                  maxLength={80}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !name.trim() || !text.trim()}
                  onClick={() =>
                    void run(async () => {
                      const result = await onPreview(recipients());
                      await onSaveList({
                        name,
                        recipients: result.recipients,
                        ...(editing
                          ? {
                              listId: editing._id,
                              expectedRevision: editing.revision,
                            }
                          : {}),
                      });
                      setEditing(null);
                      setNotice("List saved.");
                    })
                  }
                >
                  {editing ? "Update list" : "Save list"}
                </Button>
                {editing ? (
                  <Button disabled={busy} onClick={() => setDeleting(editing)}>
                    Delete list
                  </Button>
                ) : null}
              </div>
              {deleting ? (
                <div
                  role="dialog"
                  aria-label="Delete recipient list"
                  className="rounded-control border border-border p-4"
                >
                  <p>Delete {deleting.name}?</p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await onRemoveList(deleting._id);
                          setDeleting(null);
                          setEditing(null);
                          setName("");
                          setNotice("List deleted.");
                        })
                      }
                    >
                      Confirm deletion
                    </Button>
                    <Button disabled={busy} onClick={() => setDeleting(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </Card>
          <Card padding="lg">
            <div className="grid gap-5">
              <SectionTitle>Destination and timing</SectionTitle>
              <Field>
                Destination
                <Select
                  value={destination}
                  disabled={busy}
                  onChange={(event) => setDestination(event.target.value)}
                >
                  {canGroup ? (
                    <option value="group">Primary group</option>
                  ) : null}
                  {canInstance ? (
                    <>
                      <option value="instance">Existing instance</option>
                      <option value="scheduled_instance">
                        Instance creation
                      </option>
                    </>
                  ) : null}
                </Select>
              </Field>
              {destination === "instance" ? (
                <>
                  <Field>
                    Instance
                    <Select
                      value={instanceId}
                      onChange={(event) => setInstanceId(event.target.value)}
                      disabled={busy}
                    >
                      <option value="">Choose instance</option>
                      {instances.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name || item.id}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {instanceControls}
                </>
              ) : null}
              {destination === "scheduled_instance" ? (
                <>
                  <Field>
                    Instance creation
                    <Select
                      value={creationId}
                      onChange={(event) => setCreationId(event.target.value)}
                      disabled={busy}
                    >
                      <option value="">Choose creation</option>
                      {creations
                        .filter(
                          (item) =>
                            item.payload.kind === "create_instance" &&
                            [
                              "pending",
                              "claimed",
                              "submitted",
                              "succeeded",
                            ].includes(item.state),
                        )
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {metricTime(item.dueAt)} · {item.state} ·{" "}
                            {item.payload.kind === "create_instance"
                              ? item.payload.worldId
                              : ""}
                          </option>
                        ))}
                    </Select>
                  </Field>
                  {moreCreations}
                </>
              ) : null}
              {destination !== "group" && botUrl ? (
                <a
                  className="w-fit text-sm underline"
                  href={botUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open assigned bot in VRChat
                </a>
              ) : null}
              <Field>
                Send invitations
                <Select
                  value={timing}
                  disabled={busy}
                  onChange={(event) => setTiming(event.target.value)}
                >
                  <option value="now">Now</option>
                  <option value="fixed">Date and time</option>
                  <option value="event">Relative to event</option>
                </Select>
              </Field>
              {timing === "fixed" ? (
                <Field>
                  Invitation time
                  <Input
                    type="datetime-local"
                    value={date}
                    disabled={busy}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </Field>
              ) : null}
              {timing === "event" ? (
                <>
                  <Field>
                    Event
                    <Select
                      value={eventId}
                      disabled={busy}
                      onChange={(event) => setEventId(event.target.value)}
                    >
                      <option value="">Choose event</option>
                      {events.map((event) => (
                        <option
                          value={event.id}
                          key={event.id}
                          disabled={event.status === "cancelled"}
                        >
                          {event.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {moreEvents}
                  <Field>
                    Minutes after event start
                    <Input
                      type="number"
                      value={offset}
                      disabled={busy}
                      onChange={(event) => setOffset(event.target.value)}
                    />
                  </Field>
                </>
              ) : null}
              <Button
                className="w-fit"
                variant="primary"
                disabled={busy || !text.trim() || (!canGroup && !canInstance)}
                onClick={() => void run(prepare)}
              >
                Review invitations
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

const states = {
  pending: "Pending",
  claimed: "Preparing",
  submitted: "Submitted",
  succeeded: "Sent",
  rejected: "Failed",
  indeterminate: "Outcome unknown",
  cancelled: "Cancelled",
  missed: "Missed",
};
function BatchOutcomes({ batchId }: { batchId: Id<"clubInvitationBatches"> }) {
  const result = useQuery(api.clubInvitations.outcomes, { batchId });
  const cancel = useMutation(api.clubInvitations.cancel);
  return (
    <InvitationOutcomes
      result={result}
      onCancel={async () => {
        await cancel({ batchId });
      }}
    />
  );
}

export function InvitationOutcomes({
  result,
  onCancel,
}: {
  result: FunctionReturnType<typeof api.clubInvitations.outcomes> | undefined;
  onCancel: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  if (!result) return <p>Loading outcomes…</p>;
  return (
    <div className="mt-4 grid gap-4">
      {error ? (
        <Notice variant="error" role="alert">
          {error}
        </Notice>
      ) : null}
      <ul className="divide-y divide-border">
        {result.recipients.map((item) => (
          <li
            key={item.operationId}
            className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_10rem]"
          >
            <div>
              <a
                href={`https://vrchat.com/home/user/${encodeURIComponent(item.userId)}`}
                target="_blank"
                rel="noreferrer"
                className="break-all font-mono text-xs underline"
              >
                {item.userId}
              </a>
              {item.reviewedUserId !== item.userId ? (
                <p className="break-all text-xs text-muted">
                  Originally reviewed: {item.reviewedUserId}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-muted">
                {metricTime(item.dueAt)}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium">{states[item.state]}</p>
              {item.code ? (
                <p className="text-xs text-muted">
                  {operationReason(item.code)}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {result.canCancel &&
      result.recipients.some((item) =>
        ["pending", "claimed"].includes(item.state),
      ) ? (
        <Button
          className="w-fit"
          disabled={busy}
          onClick={() => setConfirm(true)}
        >
          Cancel unsent invitations
        </Button>
      ) : null}
      {confirm ? (
        <div
          role="dialog"
          aria-label="Cancel unsent invitations"
          className="rounded-control border border-border p-4"
        >
          <p>Cancel invitations that have not been submitted?</p>
          <div className="mt-3 flex gap-2">
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await onCancel();
                  setConfirm(false);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Unable to cancel invitations.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm cancellation
            </Button>
            <Button disabled={busy} onClick={() => setConfirm(false)}>
              Keep invitations
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RecipientEligibility({
  communityProfileId,
  userId,
  destination,
}: {
  communityProfileId: Id<"profiles">;
  userId: string;
  destination: Enqueue["destination"];
}) {
  const [requested, setRequested] = useState(false);
  const check = useClubProviderRead(
    communityProfileId,
    requested && destination.kind !== "group"
      ? {
          kind: "invitation_eligibility",
          n: 1,
          offset: 0,
          userId,
          ...(destination.kind === "instance"
            ? {
                worldId: destination.worldId,
                instanceId: destination.instanceId,
              }
            : {}),
        }
      : null,
  );
  if (destination.kind === "group") return null;
  const result = check.data?.items[0];
  const labels = {
    eligible: "Invitation check passed",
    not_friend: "Not friends with bot",
    destination_closed: "Instance closed",
    destination_pending: "Awaiting instance creation",
  };
  return (
    <div className="mt-2 grid gap-2 text-sm">
      {result?.invitationEligibility ? (
        <p>
          {labels[result.invitationEligibility]}
          {!check.fresh ? " · Check expired" : ""}
        </p>
      ) : (
        <p className="text-muted">Eligibility not checked</p>
      )}
      {result?.friendship && result.invitationEligibility !== "not_friend" ? (
        <p className="text-xs text-muted">
          {result.friendship === "friend"
            ? "Friends with assigned bot"
            : "Not friends with assigned bot"}
        </p>
      ) : null}
      {check.error ? <Notice variant="error">{check.error}</Notice> : null}
      <Button
        className="w-fit"
        size="sm"
        disabled={check.loading}
        onClick={() => {
          if (requested) check.refresh();
          else setRequested(true);
        }}
      >
        {check.loading ? "Checking eligibility…" : "Check eligibility"}
      </Button>
    </div>
  );
}

function InvitationsContent() {
  const workspace = useClubWorkspace(),
    communityProfileId = workspace.community._id;
  const context = useQuery(api.clubProviderReads.context, {
    communityProfileId,
  });
  const owner = workspace.actor.kind === "owner";
  const canGroup =
    (owner || workspace.actor.permissions.includes("invite_group_members")) &&
    !!context?.enabledFeatures.includes("membership_management");
  const canInstance =
    (owner || workspace.actor.permissions.includes("manage_instances")) &&
    !!context?.enabledFeatures.includes("instances");
  const lists = usePaginatedQuery(
    api.clubInvitations.lists,
    { communityProfileId },
    { initialNumItems: 50 },
  );
  const batches = usePaginatedQuery(
    api.clubInvitations.batches,
    { communityProfileId },
    { initialNumItems: 20 },
  );
  const events = usePaginatedQuery(
    api.clubProviderReads.listEvents,
    { communityProfileId },
    { initialNumItems: 50 },
  );
  const creations = usePaginatedQuery(
    api.clubOperations.list,
    canInstance ? { communityProfileId } : "skip",
    { initialNumItems: 50 },
  );
  const [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<Id<"clubInvitationBatches"> | null>(
      null,
    );
  const instances = useClubProviderRead(
    communityProfileId,
    canInstance ? { kind: "instances", n: 100, offset } : null,
  );
  const client = useConvex(),
    enqueue = useMutation(api.clubInvitations.enqueue),
    save = useMutation(api.clubInvitations.saveList),
    remove = useMutation(api.clubInvitations.removeList);
  const more = (
    query: { status: string; loadMore: (count: number) => void },
    label: string,
    count = 50,
  ) =>
    query.status === "CanLoadMore" ? (
      <Button size="sm" className="w-fit" onClick={() => query.loadMore(count)}>
        {label}
      </Button>
    ) : null;
  return (
    <div className="grid gap-6">
      <h1 className="text-3xl font-semibold">Invitations</h1>
      {context === undefined ? (
        <p>Loading invitations…</p>
      ) : (
        <InvitationComposer
          lists={lists.results}
          events={events.results}
          instances={instances.fresh ? instances.data?.items ?? [] : []}
          instancesFresh={instances.fresh}
          creations={creations.results}
          canGroup={canGroup}
          canInstance={canInstance}
          botUrl={context.assignedBot?.profileUrl}
          onPreview={(recipients) =>
            client.query(api.clubInvitations.preview, {
              communityProfileId,
              recipients,
            })
          }
          onEnqueue={async ({
            requestId,
            reviewedRecipients,
            destination,
            schedule,
          }) => {
            const id = await enqueue({
              communityProfileId,
              requestId,
              reviewedRecipients,
              destination,
              schedule,
            });
            setSelected(id);
          }}
          onSaveList={async (args) => {
            await save({ communityProfileId, ...args });
          }}
          onRemoveList={async (listId) => {
            await remove({ communityProfileId, listId });
          }}
          recipientEligibility={(userId, destination) => (
            <RecipientEligibility
              key={`${userId}:${JSON.stringify(destination)}`}
              communityProfileId={communityProfileId}
              userId={userId}
              destination={destination}
            />
          )}
          moreLists={more(lists, "Load more lists")}
          moreEvents={more(events, "Load more events")}
          moreCreations={more(creations, "Load more creations")}
          instanceControls={
            <div className="grid gap-2">
              {instances.error ? (
                <Notice variant="error">{instances.error}</Notice>
              ) : null}
              {instances.loading ? (
                <p className="text-sm text-muted">Loading instances…</p>
              ) : null}
              {instances.data && !instances.fresh ? (
                <Notice>Instance unavailable.</Notice>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={instances.loading}
                  onClick={instances.refresh}
                >
                  Refresh instances
                </Button>
                {offset > 0 ? (
                  <Button
                    size="sm"
                    onClick={() => setOffset(Math.max(0, offset - 100))}
                  >
                    Previous instances
                  </Button>
                ) : null}
                {instances.fresh && instances.data?.nextOffset != null ? (
                  <Button
                    size="sm"
                    onClick={() => setOffset(instances.data!.nextOffset!)}
                  >
                    Next instances
                  </Button>
                ) : null}
              </div>
            </div>
          }
        />
      )}
      <Card padding="lg">
        <SectionTitle>Invitation history</SectionTitle>
        <div className="mt-4 divide-y divide-border">
          {batches.results.map((batch) => (
            <div key={batch.id} className="py-4">
              <Button
                className="max-w-full text-left"
                onClick={() =>
                  setSelected(selected === batch.id ? null : batch.id)
                }
              >
                {batch.recipientCount} recipients ·{" "}
                {batch.destinationKind === "group"
                  ? "Group"
                  : batch.destinationKind === "instance"
                    ? "Instance"
                    : "Instance creation"}{" "}
                · {metricTime(batch.createdAt)}
              </Button>
              {selected === batch.id ? (
                <BatchOutcomes batchId={batch.id} />
              ) : null}
            </div>
          ))}
        </div>
        {batches.status === "LoadingFirstPage" ? <p>Loading history…</p> : null}
        {batches.status === "Exhausted" && !batches.results.length ? (
          <p className="mt-4 text-sm text-muted">No invitation batches.</p>
        ) : null}
        {more(batches, "Load more batches", 20)}
      </Card>
    </div>
  );
}

export function ClubInvitationBatches() {
  const workspace = useClubWorkspace();
  return workspace.actor.kind === "owner" ||
    workspace.actor.permissions.some((permission) =>
      ["invite_group_members", "manage_instances"].includes(permission),
    ) ? (
    <InvitationsContent />
  ) : (
    <ClubAccessNotice />
  );
}
