"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@convex-generated-api";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import {
  Field,
  Input,
  Textarea,
  Select,
  CheckboxField,
} from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useClubWorkspace, ClubAccessNotice } from "./club-workspace";
import { useClubProviderRead, type ProviderItem } from "./club-provider-read";
import { metricTime } from "./club-chart";
type Content = FunctionArgs<typeof api.clubPosts.save>["content"];
type Draft = FunctionReturnType<typeof api.clubPosts.save>;
type Schedule = FunctionArgs<typeof api.clubPosts.queue>["schedule"];
type EventOption = FunctionReturnType<
  typeof api.clubProviderReads.listEvents
>["page"][number];
const blank: Content = {
  title: "",
  text: "",
  visibility: "group",
  sendNotification: false,
};

export function PostEditor({
  initial = blank,
  events = [],
  busy = false,
  onSave,
  onQueue,
  onClose,
}: {
  initial?: Content;
  events?: EventOption[];
  busy?: boolean;
  onSave: (content: Content) => Promise<void>;
  onQueue: (content: Content, schedule: Schedule) => Promise<void>;
  onClose: () => void;
}) {
  const [content, setContent] = useState(initial),
    [preview, setPreview] = useState(false),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [timing, setTiming] = useState("now"),
    [date, setDate] = useState(""),
    [eventId, setEventId] = useState(""),
    [offset, setOffset] = useState("0");
  const action = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save post.");
    }
  };
  const schedule = (): Schedule => {
    if (timing === "event") {
      const event = events.find((e) => e.id === eventId);
      if (
        !event ||
        event.status === "cancelled" ||
        !Number.isFinite(Number(offset))
      )
        throw new Error("Choose an event and a valid offset.");
      return {
        kind: "event_relative",
        eventId: event.id,
        offsetMs: Number(offset) * 60000,
      };
    }
    if (timing === "now") return { kind: "immediate" };
    const dueAt = new Date(date).getTime();
    if (!Number.isFinite(dueAt) || dueAt <= Date.now())
      throw new Error("Choose a future date and time.");
    return { kind: "fixed", dueAt };
  };
  return (
    <Card padding="lg">
      <div className="flex justify-between gap-3">
        <SectionTitle>
          {content.providerPostId ? "Edit post" : "New post"}
        </SectionTitle>
        <Button size="sm" onClick={onClose} disabled={busy}>
          Close
        </Button>
      </div>
      <div className="mt-5 grid gap-4">
        <Field>
          Title
          <Input
            value={content.title}
            maxLength={200}
            onChange={(e) => setContent({ ...content, title: e.target.value })}
          />
        </Field>
        <Field>
          Post
          <Textarea
            rows={7}
            maxLength={10000}
            value={content.text}
            onChange={(e) => setContent({ ...content, text: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            Audience
            <Select
              value={content.visibility}
              onChange={(e) =>
                setContent({
                  ...content,
                  visibility: e.target.value as Content["visibility"],
                })
              }
            >
              <option value="group">Group</option>
              <option value="public">Public</option>
            </Select>
          </Field>
          <Field>
            Publish
            <Select value={timing} onChange={(e) => setTiming(e.target.value)}>
              <option value="now">Now</option>
              <option value="fixed">Date and time</option>
              <option value="event">Relative to event</option>
            </Select>
          </Field>
        </div>
        {timing === "fixed" ? (
          <Field>
            Publication time
            <Input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        ) : null}
        {timing === "event" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              Event
              <Select
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
              >
                <option value="">Choose event</option>
                {events.map((e) => (
                  <option
                    key={e.id}
                    value={e.id}
                    disabled={e.status === "cancelled"}
                  >
                    {e.title} · {metricTime(e.startAt)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              Minutes after event start
              <Input
                type="number"
                value={offset}
                onChange={(e) => setOffset(e.target.value)}
              />
            </Field>
          </div>
        ) : null}
        <CheckboxField
          checked={content.sendNotification}
          onChange={(e) =>
            setContent({ ...content, sendNotification: e.target.checked })
          }
        >
          Notify group members
        </CheckboxField>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setPreview(!preview)}>
            {preview ? "Hide preview" : "Preview"}
          </Button>
          <Button disabled={busy} onClick={() => action(() => onSave(content))}>
            Save draft
          </Button>
          <Button
            variant="primary"
            disabled={busy || !content.title.trim() || !content.text.trim()}
            onClick={() => {
              setError(null);
              try {
                schedule();
                setConfirm(true);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {timing === "now"
              ? content.providerPostId
                ? "Queue changes"
                : "Publish now"
              : "Schedule post"}
          </Button>
        </div>
        {preview ? (
          <article
            className="border-t border-border pt-5"
            aria-label="Post preview"
          >
            <h3 className="text-xl font-semibold">
              {content.title || "Untitled post"}
            </h3>
            <p className="mt-3 whitespace-pre-wrap break-words">
              {content.text}
            </p>
            <p className="mt-4 text-xs text-muted">
              {content.visibility === "group" ? "Group" : "Public"} ·{" "}
              {content.sendNotification
                ? "Notifications on"
                : "Notifications off"}
            </p>
          </article>
        ) : null}
        {confirm ? (
          <div
            role="dialog"
            aria-label="Confirm post"
            className="border-t border-border pt-4"
          >
            <p className="font-medium">
              {content.providerPostId
                ? "Queue changes to this post?"
                : "Queue this post?"}
            </p>
            <p className="mt-2 text-sm text-muted">
              {content.sendNotification
                ? "Group members will be notified."
                : "No group notification."}
            </p>
            <div className="mt-3 flex gap-3">
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await onQueue(content, schedule());
                    setConfirm(false);
                  })
                }
              >
                Confirm
              </Button>
              <Button disabled={busy} onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {error ? (
          <Notice variant="error" role="alert">
            {error}
          </Notice>
        ) : null}
      </div>
    </Card>
  );
}
function PostsContent() {
  const workspace = useClubWorkspace(),
    communityProfileId = workspace.community._id;
  const drafts = usePaginatedQuery(
    api.clubPosts.list,
    { communityProfileId },
    { initialNumItems: 20 },
  );
  const eventOptions = usePaginatedQuery(
    api.clubProviderReads.listEvents,
    { communityProfileId },
    { initialNumItems: 50 },
  );
  const [offset, setOffset] = useState(0),
    [editing, setEditing] = useState<{
      key: string;
      draft?: Draft;
      content: Content;
      queueAttempt?: { content: Content; schedule: Schedule; draft: Draft };
    } | null>(null),
    [deleting, setDeleting] = useState<
      (ProviderItem & { requestId: string }) | null
    >(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const read = useClubProviderRead(communityProfileId, {
    kind: "posts",
    n: 20,
    offset,
  });
  const save = useMutation(api.clubPosts.save),
    queue = useMutation(api.clubPosts.queue),
    remove = useMutation(api.clubPosts.remove),
    enqueue = useMutation(api.clubOperations.enqueue);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update post.");
    } finally {
      setBusy(false);
    }
  };
  const persist = async (content: Content) => {
    if (!editing) throw new Error("No draft selected.");
    return save({
      communityProfileId,
      clientId: editing.key,
      ...(editing.draft
        ? {
            draftId: editing.draft.id,
            expectedRevision: editing.draft.revision,
          }
        : {}),
      content,
    });
  };
  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Posts</h1>
        <Button
          variant="primary"
          onClick={() =>
            setEditing({ key: crypto.randomUUID(), content: blank })
          }
        >
          New post
        </Button>
      </div>
      {notice ? <Notice role="status">{notice}</Notice> : null}
      {error ? (
        <Notice role="alert" variant="error">
          {error}
        </Notice>
      ) : null}
      {editing ? (
        <PostEditor
          key={editing.key}
          initial={editing.content}
          events={eventOptions.results}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (c) => {
            setBusy(true);
            try {
              const draft = await persist(c);
              setEditing({ ...editing, draft, content: c, queueAttempt: undefined });
              setNotice("Draft saved.");
            } finally {
              setBusy(false);
            }
          }}
          onQueue={async (c, schedule) => {
            setBusy(true);
            try {
              const previous = editing.queueAttempt;
              const unchanged =
                previous &&
                JSON.stringify([previous.content, previous.schedule]) ===
                  JSON.stringify([c, schedule]);
              const draft = unchanged ? previous.draft : await persist(c);
              setEditing({
                ...editing,
                draft,
                content: c,
                queueAttempt: { content: c, schedule, draft },
              });
              await queue({
                communityProfileId,
                draftId: draft.id,
                expectedRevision: draft.revision,
                schedule,
              });
              setEditing(null);
              setNotice("Post queued.");
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
      {editing && eventOptions.status === "CanLoadMore" ? (
        <Button onClick={() => eventOptions.loadMore(50)}>
          Load more events
        </Button>
      ) : null}
      <Card padding="lg">
        <SectionTitle>My drafts</SectionTitle>
        <div className="mt-3 divide-y divide-border">
          {drafts.results.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 py-4"
            >
              <div>
                <p className="font-medium">
                  {d.content.title || "Untitled post"}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {d.operationState ?? "Draft"} · {metricTime(d.updatedAt)}
                </p>
              </div>
              <div className="flex gap-2">
                {d.operationId ? (
                  <Link
                    className="text-sm underline"
                    href={`/account/communities/${workspace.community.slug}/scheduled`}
                  >
                    View action
                  </Link>
                ) : (
                  <>
                    <Button
                      size="sm"
                      onClick={() =>
                        setEditing({
                          key: crypto.randomUUID(),
                          draft: d,
                          content: d.content,
                        })
                      }
                    >
                      Edit draft
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await remove({
                            communityProfileId,
                            draftId: d.id,
                            expectedRevision: d.revision,
                          });
                        })
                      }
                    >
                      Delete draft
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        {drafts.status === "LoadingFirstPage" ? (
          <Notice>Loading drafts…</Notice>
        ) : drafts.results.length === 0 ? (
          <Notice variant="dashed">No drafts.</Notice>
        ) : null}
        {drafts.status === "CanLoadMore" ? (
          <Button onClick={() => drafts.loadMore(20)}>Load more drafts</Button>
        ) : null}
      </Card>
      <Card padding="lg">
        <div className="flex items-center justify-between">
          <SectionTitle>Published posts</SectionTitle>
          <Button size="sm" onClick={read.refresh} disabled={read.loading}>
            Refresh
          </Button>
        </div>
        {read.error ? (
          <Notice className="mt-4" variant="error">
            {read.error}
          </Notice>
        ) : null}
        {read.loading ? <Notice className="mt-4">Loading posts…</Notice> : null}
        <div className="divide-y divide-border">
          {read.data?.items.map((p) => (
            <article className="py-5" key={p.id}>
              <h3 className="text-lg font-semibold">
                {p.title ?? "Untitled post"}
              </h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                {p.text}
              </p>
              <div className="mt-4 flex gap-2">
                <Button
                  size="sm"
                  disabled={!read.fresh}
                  onClick={() =>
                    setEditing({
                      key: crypto.randomUUID(),
                      content: {
                        title: p.title ?? "",
                        text: p.text ?? "",
                        visibility:
                          p.visibility === "public" ? "public" : "group",
                        sendNotification: false,
                        providerPostId: p.id,
                        ...(p.roleIds ? { roleIds: p.roleIds } : {}),
                        ...(p.imageId ? { imageId: p.imageId } : {}),
                      },
                    })
                  }
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  disabled={!read.fresh}
                  onClick={() =>
                    setDeleting({
                      ...p,
                      requestId: crypto.randomUUID(),
                    })
                  }
                >
                  Delete
                </Button>
              </div>
            </article>
          ))}
        </div>
        {read.data && read.data.items.length === 0 ? (
          <Notice className="mt-4" variant="dashed">
            No posts.
          </Notice>
        ) : null}
        <div className="mt-4 flex gap-3">
          <Button
            disabled={offset === 0 || read.loading}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            Previous
          </Button>
          <Button
            disabled={read.data?.nextOffset == null || read.loading}
            onClick={() => setOffset(read.data!.nextOffset!)}
          >
            Next
          </Button>
        </div>
      </Card>
      {deleting ? (
        <Card padding="lg" role="dialog" aria-label="Delete post">
          <SectionTitle>
            Delete “{deleting.title ?? "Untitled post"}”?
          </SectionTitle>
          <div className="mt-4 flex gap-3">
            <Button
              variant="primary"
              disabled={busy || !read.fresh}
              onClick={() =>
                run(async () => {
                  await enqueue({
                    communityProfileId,
                    requestId: deleting.requestId,
                    payloads: [{ kind: "delete_post", postId: deleting.id }],
                    schedule: { kind: "immediate" },
                  });
                  setDeleting(null);
                  setNotice("Post deletion queued.");
                })
              }
            >
              Confirm deletion
            </Button>
            <Button disabled={busy} onClick={() => setDeleting(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
export function ClubPosts() {
  const workspace = useClubWorkspace();
  const allowed =
    workspace.actor.kind === "owner" ||
    workspace.actor.permissions.includes("publish_posts");
  const context = useQuery(
    api.clubProviderReads.context,
    allowed ? { communityProfileId: workspace.community._id } : "skip",
  );
  if (!allowed) return <ClubAccessNotice />;
  if (!context) return <Notice>Loading posts…</Notice>;
  if (!context.enabledFeatures.includes("posts"))
    return <Notice>Posts are disabled.</Notice>;
  return <PostsContent />;
}
