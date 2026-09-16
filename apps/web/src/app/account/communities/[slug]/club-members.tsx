"use client";

import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { api } from "@convex-generated-api";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { CheckboxField, Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { ClubAccessNotice, useClubWorkspace } from "./club-workspace";
import {
  useClubProviderRead,
  type ProviderItem,
  type ProviderReadParams,
} from "./club-provider-read";
import { metricTime } from "./club-chart";

type Payload = FunctionArgs<
  typeof api.clubOperations.enqueue
>["payloads"][number];
type Submission = FunctionArgs<typeof api.clubOperations.enqueue>;
type Tab = "members" | "requests" | "invites" | "bans";
const actionLabels: Record<string, string> = {
  approve_request: "Approve request",
  reject_request: "Reject request",
  invite_member: "Invite member",
  cancel_member_invite: "Cancel invitation",
  assign_role: "Assign role",
  remove_role: "Remove role",
  remove_member: "Remove member",
  ban_member: "Ban member",
  unban_member: "Unban member",
};
const stateLabels: Record<string, string> = {
  pending: "Queued",
  claimed: "Preparing",
  submitted: "Submitted",
  succeeded: "Completed",
  rejected: "Failed",
  indeterminate: "Outcome unknown",
  cancelled: "Cancelled",
  missed: "Missed",
};
const targetId = (item: ProviderItem) => item.userId ?? item.id;

function ReadStatus({
  read,
}: {
  read: ReturnType<typeof useClubProviderRead>;
}) {
  return (
    <>
      {read.loading ? <Notice role="status">Loading…</Notice> : null}
      {read.error ? (
        <Notice variant="error" role="alert">
          {read.error}
        </Notice>
      ) : null}
      {read.data && !read.fresh ? (
        <Notice variant="warning">Refresh to continue.</Notice>
      ) : null}
    </>
  );
}

function MembersContent({
  enabled,
  permittedRoles,
  protectedIds,
  assignedBotId,
}: {
  enabled: boolean;
  permittedRoles: string[];
  protectedIds: string[];
  assignedBotId?: string;
}) {
  const workspace = useClubWorkspace();
  const communityProfileId = workspace.community._id;
  const owner = workspace.actor.kind === "owner";
  const can = (permission: string) =>
    owner || workspace.actor.permissions.some((value) => value === permission);
  const tabs = (
    [
      { key: "members", label: "Directory", permission: "view_members" },
      {
        key: "requests",
        label: "Requests",
        permission: "approve_join_requests",
      },
      {
        key: "invites",
        label: "Invitations",
        permission: "invite_group_members",
      },
      { key: "bans", label: "Bans", permission: "manage_bans" },
    ] as const
  ).filter((tab) => can(tab.permission));
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? "members");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [selected, setSelected] = useState<ProviderItem[]>([]);
  const [detail, setDetail] = useState<ProviderItem | null>(null);
  const [roleId, setRoleId] = useState("");
  const [roleOffset, setRoleOffset] = useState(0);
  const [inviteId, setInviteId] = useState("");
  const [review, setReview] = useState<{
    submission: Submission;
    targets: ProviderItem[];
    roleName?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enqueue = useMutation(api.clubOperations.enqueue);
  const cancel = useMutation(api.clubOperations.cancel);
  const params: ProviderReadParams = {
    kind: tab === "members" && query ? "search" : tab,
    n: 25,
    offset,
    ...(tab === "members" && query ? { search: query } : {}),
  };
  const read = useClubProviderRead(
    communityProfileId,
    enabled && tabs.some((t) => t.key === tab) ? params : null,
  );
  const member = useClubProviderRead(
    communityProfileId,
    enabled && detail && can("view_members")
      ? { kind: "member", userId: targetId(detail), n: 1, offset: 0 }
      : null,
  );
  const roles = useClubProviderRead(
    communityProfileId,
    enabled && can("assign_vrchat_roles")
      ? { kind: "roles", n: 100, offset: roleOffset }
      : null,
  );
  const operations = usePaginatedQuery(
    api.clubOperations.list,
    { communityProfileId },
    { initialNumItems: 25 },
  );
  const allowedRoles =
    roles.data?.items.filter(
      (role) => owner || permittedRoles.includes(role.id),
    ) ?? [];
  const selectedRole = allowedRoles.find((role) => role.id === roleId);
  const currentMember = member.data?.items[0] ?? detail;
  const rows = read.data?.items ?? [];
  const chooseTab = (value: Tab) => {
    setTab(value);
    setOffset(0);
    setHistory([]);
    setSelected([]);
    setDetail(null);
    setQuery("");
    setSearch("");
  };
  const prepare = (kind: Payload["kind"], targets: ProviderItem[]) => {
    if (targets.length === 0) return;
    const payloads = targets.map((item) =>
      kind === "assign_role" || kind === "remove_role"
        ? { kind, targetUserId: targetId(item), roleId }
        : { kind, targetUserId: targetId(item) },
    ) as Payload[];
    setError(null);
    setReview({
      submission: {
        communityProfileId,
        requestId: crypto.randomUUID(),
        payloads,
        schedule: { kind: "fixed", dueAt: Date.now() },
      },
      targets,
      ...((kind === "assign_role" || kind === "remove_role") && selectedRole
        ? { roleName: selectedRole.name ?? selectedRole.id }
        : {}),
    });
  };
  const action = (
    kind: Payload["kind"],
    permission: string,
    item: ProviderItem,
  ) =>
    can(permission) ? (
      <Button
        key={kind}
        size="sm"
        disabled={
          !enabled || !read.fresh || protectedIds.includes(targetId(item))
        }
        onClick={() => prepare(kind, [item])}
      >
        {actionLabels[kind]}
      </Button>
    ) : null;
  if (!enabled)
    return <Notice variant="warning">Member management is disabled.</Notice>;
  if (tabs.length === 0) return <ClubAccessNotice />;
  return (
    <div className="grid gap-6">
      <h1 className="text-3xl font-semibold">Members</h1>
      {assignedBotId && can("view_members") ? (
        <div>
          <Button
            size="sm"
            onClick={() => setDetail({ id: assignedBotId, userId: assignedBotId })}
          >
            View assigned bot
          </Button>
        </div>
      ) : null}
      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label="Member management"
      >
        {tabs.map((item) => (
          <Button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => chooseTab(item.key)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {error ? (
        <Notice variant="error" role="alert">
          {error}
        </Notice>
      ) : null}
      {review ? (
        <Card padding="lg">
          <SectionTitle>Review action</SectionTitle>
          <p className="mt-3 font-semibold">
            {actionLabels[review.submission.payloads[0]!.kind]}
          </p>
          <ul className="mt-3 grid gap-1 text-sm">
            {review.targets.map((item) => (
              <li key={targetId(item)}>
                {item.displayName ?? targetId(item)}
                {item.displayName ? (
                  <span className="mt-1 block break-all text-xs text-muted">
                    {targetId(item)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {review.roleName ? (
            <p className="mt-3 text-sm">{review.roleName}</p>
          ) : null}
          <div className="mt-5 flex gap-3">
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await enqueue(review.submission);
                  setReview(null);
                  setSelected([]);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Unable to queue action.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm action
            </Button>
            <Button disabled={busy} onClick={() => setReview(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
      {detail && can("view_members") ? (
        <Card padding="lg">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle>
              {currentMember?.displayName ?? targetId(detail)}
            </SectionTitle>
            <Button onClick={() => setDetail(null)}>Close detail</Button>
          </div>
          <p className="mt-2 break-all text-xs text-muted">
            {targetId(detail)}
          </p>
          <div className="mt-5">
            <ReadStatus read={member} />
          </div>
          {currentMember?.joinedAt ? (
            <p className="mt-3 text-sm">
              Joined {metricTime(Date.parse(currentMember.joinedAt))}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {currentMember?.roleIds?.map((id) => (
              <span key={id} className="text-sm">
                {roles.data?.items.find((role) => role.id === id)?.name ?? id}
              </span>
            ))}
          </div>
          <Button className="mt-4" size="sm" onClick={member.refresh}>
            Refresh member
          </Button>
        </Card>
      ) : null}
      <Card padding="lg">
        <div className="flex flex-wrap items-end justify-between gap-4">
          {tab === "members" ? (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setQuery(search.trim());
                setOffset(0);
                setHistory([]);
                setSelected([]);
              }}
            >
              <Field>
                Search members
                <Input
                  value={search}
                  minLength={3}
                  maxLength={100}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </Field>
              <Button type="submit">Search</Button>
              {query ? (
                <Button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setQuery("");
                    setOffset(0);
                    setHistory([]);
                    setSelected([]);
                  }}
                >
                  Clear search
                </Button>
              ) : null}
            </form>
          ) : (
            <SectionTitle>
              {tabs.find((item) => item.key === tab)?.label}
            </SectionTitle>
          )}
          <Button
            onClick={() => {
              read.refresh();
              setSelected([]);
            }}
            disabled={read.loading}
          >
            Refresh
          </Button>
        </div>
        <div className="mt-5">
          <ReadStatus read={read} />
        </div>
        {can("invite_group_members") && tab === "invites" ? (
          <form
            className="my-5 flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              prepare("invite_member", [{ id: inviteId, userId: inviteId }]);
            }}
          >
            <Field>
              VRChat user ID
              <Input
                required
                pattern="usr_[0-9a-fA-F-]{36}"
                value={inviteId}
                onChange={(event) => setInviteId(event.target.value)}
              />
            </Field>
            <Button type="submit">Invite member</Button>
          </form>
        ) : null}
        {selected.length > 0 ? (
          <div className="my-5 flex flex-wrap items-end gap-3">
            <span className="text-sm">{selected.length} selected</span>
            {tab === "requests" ? (
              <>
                <Button
                  disabled={!read.fresh}
                  onClick={() => prepare("approve_request", selected)}
                >
                  Approve selected
                </Button>
                <Button
                  disabled={!read.fresh}
                  onClick={() => prepare("reject_request", selected)}
                >
                  Reject selected
                </Button>
              </>
            ) : null}
            {tab === "members" && can("assign_vrchat_roles") ? (
              <>
                <Field>
                  VRChat role
                  <Select
                    aria-label="VRChat role"
                    value={roleId}
                    onChange={(event) => setRoleId(event.target.value)}
                  >
                    <option value="">Select role</option>
                    {allowedRoles.map((role) => (
                      <option value={role.id} key={role.id}>
                        {role.name ?? role.id}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  disabled={!selectedRole || !roles.fresh || !read.fresh}
                  onClick={() => prepare("assign_role", selected)}
                >
                  Assign selected
                </Button>
                <Button
                  disabled={!selectedRole || !roles.fresh || !read.fresh}
                  onClick={() => prepare("remove_role", selected)}
                >
                  Remove selected role
                </Button>
                {roles.data?.nextOffset !== null &&
                roles.data?.nextOffset !== undefined ? (
                  <Button
                    onClick={() => {
                      setRoleOffset(roles.data!.nextOffset!);
                      setRoleId("");
                    }}
                  >
                    More roles
                  </Button>
                ) : null}
                {roleOffset > 0 ? (
                  <Button
                    onClick={() => {
                      setRoleOffset(0);
                      setRoleId("");
                    }}
                  >
                    First roles
                  </Button>
                ) : null}
                <Button onClick={roles.refresh}>Refresh roles</Button>
                <ReadStatus read={roles} />
              </>
            ) : null}
          </div>
        ) : null}
        <div className="mt-4 divide-y divide-border">
          {rows.map((item) => (
            <div
              key={targetId(item)}
              className="flex flex-wrap items-center justify-between gap-4 py-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                {(tab === "requests" ||
                  (tab === "members" && can("assign_vrchat_roles"))) &&
                !protectedIds.includes(targetId(item)) ? (
                  <CheckboxField
                    aria-label={`Select ${item.displayName ?? targetId(item)}`}
                    checked={selected.some(
                      (row) => targetId(row) === targetId(item),
                    )}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, item]
                          : current.filter(
                              (row) => targetId(row) !== targetId(item),
                            ),
                      )
                    }
                  >
                    {""}
                  </CheckboxField>
                ) : null}
                <div className="min-w-0">
                  {can("view_members") ? (
                    <button
                      className="cursor-pointer text-left font-semibold text-accent hover:underline"
                      onClick={() => setDetail(item)}
                    >
                      {item.displayName ?? targetId(item)}
                    </button>
                  ) : (
                    <p className="font-semibold">
                      {item.displayName ?? targetId(item)}
                    </p>
                  )}
                  <p className="mt-1 break-all text-xs text-muted">
                    {targetId(item)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {tab === "requests" ? (
                  <>
                    {action("approve_request", "approve_join_requests", item)}
                    {action("reject_request", "approve_join_requests", item)}
                  </>
                ) : null}
                {tab === "invites"
                  ? action("cancel_member_invite", "invite_group_members", item)
                  : null}
                {tab === "members" ? (
                  <>
                    {action("remove_member", "remove_group_members", item)}
                    {action("ban_member", "manage_bans", item)}
                  </>
                ) : null}
                {tab === "bans"
                  ? action("unban_member", "manage_bans", item)
                  : null}
              </div>
            </div>
          ))}
        </div>
        {!read.loading && !read.error && rows.length === 0 ? (
          <Notice variant="dashed" className="mt-4">
            No results.
          </Notice>
        ) : null}
        <div className="mt-5 flex gap-3">
          <Button
            disabled={history.length === 0 || read.loading}
            onClick={() => {
              setOffset(history.at(-1)!);
              setHistory((value) => value.slice(0, -1));
              setSelected([]);
            }}
          >
            Previous page
          </Button>
          <Button
            disabled={read.data?.nextOffset == null || read.loading}
            onClick={() => {
              setHistory((value) => [...value, offset]);
              setOffset(read.data!.nextOffset!);
              setSelected([]);
            }}
          >
            Next page
          </Button>
        </div>
      </Card>
      <Card padding="lg">
        <SectionTitle>Recent actions</SectionTitle>
        <div className="mt-4 divide-y divide-border">
          {operations.results
            .filter((operation) => operation.payload.kind in actionLabels)
            .map((operation) => (
              <div
                key={operation.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <div>
                  <p className="text-sm font-semibold">
                    {actionLabels[operation.payload.kind]}
                  </p>
                  {"targetUserId" in operation.payload ? (
                    <p className="mt-1 break-all text-xs text-muted">
                      {operation.payload.targetUserId}
                    </p>
                  ) : null}
                </div>
                <span className="text-sm">{stateLabels[operation.state]}</span>
                {(operation.state === "pending" ||
                  operation.state === "claimed") &&
                (owner ||
                  operation.actor.tokenIdentifier ===
                    workspace.actor.subject?.tokenIdentifier ||
                  can("manage_scheduled_actions")) ? (
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        await cancel({ operationId: operation.id });
                      } catch (cause) {
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "Unable to cancel action.",
                        );
                      }
                    }}
                  >
                    Cancel action
                  </Button>
                ) : null}
              </div>
            ))}
        </div>
        {operations.status === "CanLoadMore" ? (
          <Button onClick={() => operations.loadMore(25)}>More actions</Button>
        ) : null}
      </Card>
    </div>
  );
}

export function ClubMembers() {
  const workspace = useClubWorkspace();
  const context = useQuery(api.clubProviderReads.context, {
    communityProfileId: workspace.community._id,
  });
  if (context === undefined)
    return <Notice role="status">Loading member management…</Notice>;
  return (
    <MembersContent
      enabled={context.enabledFeatures.includes("membership_management")}
      permittedRoles={context.permittedProviderRoleIds}
      protectedIds={context.protectedUserIds}
      assignedBotId={context.assignedBot?.userId}
    />
  );
}
