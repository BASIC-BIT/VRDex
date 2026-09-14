"use client";

import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, SectionHeading, SectionTitle } from "@/components/ui/card";
import { CheckboxField, Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import {
  ClubAccessNotice,
  useClubWorkspace,
  type WorkspaceData,
} from "./club-workspace";
import {
  availablePermissions,
  categoryLabels,
  permissionLabels,
  type ClubPermission,
} from "./club-workspace-model";

type Role = WorkspaceData["roles"][number];
type RoleInput = {
  roleId?: Id<"communityRoles">;
  label: string;
  description?: string;
  permissions: ClubPermission[];
  assignableRoleIds: Id<"communityRoles">[];
};
export type StaffActions = {
  seed: () => Promise<unknown>;
  save: (input: RoleInput) => Promise<unknown>;
  delete: (roleId: Id<"communityRoles">) => Promise<unknown>;
  invite: (roleIds: Id<"communityRoles">[]) => Promise<{ token: string }>;
  revokeInvite: (
    invitationId: Id<"communityStaffInvitations">,
  ) => Promise<unknown>;
  revokeAssignment: (
    assignmentId: Id<"communityAuthorities">,
  ) => Promise<unknown>;
};

function RoleEditor({
  role,
  roles,
  busy,
  onSave,
  onCancel,
}: {
  role?: Role;
  roles: Role[];
  busy: boolean;
  onSave: (value: RoleInput) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(role?.label ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [permissions, setPermissions] = useState<ClubPermission[]>(
    role?.permissions ?? [],
  );
  const [assignable, setAssignable] = useState<Id<"communityRoles">[]>(
    role?.assignableRoleIds ?? [],
  );
  return (
    <form
      className="mt-5 grid gap-5 border-t border-border pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          roleId: role?._id,
          label: label.trim(),
          description: description.trim() || undefined,
          permissions,
          assignableRoleIds: assignable,
        });
      }}
    >
      <Field>
        Role name
        <Input
          autoFocus
          required
          maxLength={80}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>
      <Field>
        Description
        <Textarea
          maxLength={500}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <fieldset>
        <legend className="mb-3 text-sm font-medium">Permissions</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(permissionLabels).map(([key, text]) => (
            <CheckboxField
              key={key}
              checked={permissions.includes(key as ClubPermission)}
              onChange={(event) =>
                setPermissions((previous) =>
                  event.target.checked
                    ? [...previous, key as ClubPermission]
                    : previous.filter((item) => item !== key),
                )
              }
            >
              <span>
                {text}
                {!availablePermissions.includes(key) ? (
                  <span className="block text-xs text-muted">
                    Not yet available
                  </span>
                ) : null}
              </span>
            </CheckboxField>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-3 text-sm font-medium">
          Roles this role can assign
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {roles
            .filter((item) => item._id !== role?._id)
            .map((item) => (
              <CheckboxField
                key={item._id}
                checked={assignable.includes(item._id)}
                onChange={(event) =>
                  setAssignable((previous) =>
                    event.target.checked
                      ? [...previous, item._id]
                      : previous.filter((id) => id !== item._id),
                  )
                }
              >
                {item.label}
              </CheckboxField>
            ))}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button
          disabled={busy || !label.trim()}
          type="submit"
          variant="primary"
        >
          Save role
        </Button>
        <Button disabled={busy} type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ClubStaffView({
  data,
  actions,
}: {
  data: WorkspaceData;
  actions: StaffActions;
}) {
  const owner = data.actor.kind === "owner";
  const allowed = owner || data.actor.permissions.includes("manage_staff");
  const ownRoleIds = new Set(data.actor.roleIds);
  const assignable = new Set(
    owner
      ? data.roles.map((role) => role._id)
      : data.roles
          .filter((role) => ownRoleIds.has(role._id))
          .flatMap((role) => role.assignableRoleIds),
  );
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const [selected, setSelected] = useState<Id<"communityRoles">[]>([]);
  const [inviteLink, setInviteLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const seeded = useRef(false);
  const roleNames = new Map(data.roles.map((role) => [role._id, role.label]));

  async function perform(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    setFailed(false);
    try {
      await action();
      setMessage(success);
      return true;
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error ? error.message : "Unable to save changes.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (owner && data.roles.length === 0 && !seeded.current) {
      seeded.current = true;
      void actions.seed().catch(() => {
        setFailed(true);
        setMessage("Unable to create preset roles.");
      });
    }
  }, [owner, data.roles.length, actions]);

  if (!allowed) return <ClubAccessNotice />;
  const groups = new Map<string, typeof data.assignments>();
  for (const assignment of data.assignments)
    groups.set(assignment.subjectTokenIdentifier, [
      ...(groups.get(assignment.subjectTokenIdentifier) ?? []),
      assignment,
    ]);
  return (
    <div className="grid gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">Staff and roles</h1>
      {message ? (
        <Notice
          variant={failed ? "error" : "success"}
          role={failed ? "alert" : "status"}
        >
          {message}
        </Notice>
      ) : null}
      <Card padding="lg">
        <SectionTitle>Club staff</SectionTitle>
        {data.hasMoreAssignments ? (
          <Notice className="mt-4" variant="warning">
            Showing the first 500 assignments. Additional staff are not shown
            here.
          </Notice>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-between gap-3 border-b border-border py-3 text-sm">
          <strong>Club owner</strong>
          <span className="text-muted">Ownership is separate from roles.</span>
        </div>
        {groups.size === 0 ? (
          <Notice className="mt-4" variant="dashed">
            No staff yet. Invite someone to get started.
          </Notice>
        ) : (
          Array.from(groups, ([identity, assignments]) => (
            <div
              key={identity}
              className="grid gap-3 border-b border-border py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
            >
              <strong className="break-words text-sm">
                {assignments[0]?.subject.displayName ?? "Staff member"}
              </strong>
              <div className="grid gap-2">
                {assignments.map((assignment) => {
                  const canRevoke =
                    (owner ||
                      (assignment.roleId &&
                        assignable.has(assignment.roleId))) &&
                    identity !== data.actor.subject?.tokenIdentifier;
                  return (
                    <div
                      key={assignment._id}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span>
                        {assignment.roleId
                          ? (roleNames.get(assignment.roleId) ??
                            "Unavailable role")
                          : "Unavailable role"}
                      </span>
                      {canRevoke ? (
                        <Button
                          size="sm"
                          variant="dangerGhost"
                          disabled={busy}
                          onClick={() =>
                            void perform(
                              () => actions.revokeAssignment(assignment._id),
                              "Assignment revoked.",
                            )
                          }
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </Card>

      <Card padding="lg">
        <SectionTitle>Invite club staff</SectionTitle>
        <form
          className="mt-5 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              const result = await actions.invite(selected);
              setInviteLink(
                `${window.location.origin}/account/communities/${encodeURIComponent(data.community.slug)}/invite/${encodeURIComponent(result.token)}`,
              );
              setSelected([]);
            }, "Invite link created.");
          }}
        >
          <fieldset>
            <legend className="mb-3 text-sm font-medium">Roles</legend>
            <div className="flex flex-wrap gap-2">
              {data.roles
                .filter((role) => assignable.has(role._id))
                .map((role) => (
                  <CheckboxField
                    key={role._id}
                    checked={selected.includes(role._id)}
                    onChange={(event) =>
                      setSelected((previous) =>
                        event.target.checked
                          ? [...previous, role._id]
                          : previous.filter((id) => id !== role._id),
                      )
                    }
                  >
                    {role.label}
                  </CheckboxField>
                ))}
            </div>
          </fieldset>
          <Button
            className="justify-self-start"
            type="submit"
            variant="primary"
            disabled={
              busy ||
              !selected.length ||
              selected.some((id) => !assignable.has(id))
            }
          >
            Create invite link
          </Button>
        </form>
        {inviteLink ? (
          <div className="mt-5 grid gap-3">
            <Field>
              Invite link
              <Input
                readOnly
                value={inviteLink}
                onFocus={(event) => event.target.select()}
              />
            </Field>
            <Button
              className="justify-self-start"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(inviteLink);
                  setFailed(false);
                  setMessage("Link copied.");
                } catch {
                  setFailed(true);
                  setMessage("Select and copy the invite link.");
                }
              }}
            >
              Copy link
            </Button>
            <p className="text-xs text-muted">
              This link works once and expires in 7 days.
            </p>
          </div>
        ) : null}
        <h3 className="mt-7 text-sm font-semibold">Invitations</h3>
        {data.invitations.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No invitations</p>
        ) : (
          <div className="mt-3 grid gap-3">
            {data.invitations.map((invitation) => {
              const state =
                invitation.state === "pending" &&
                invitation.expiresAt <= Date.now()
                  ? "expired"
                  : invitation.state;
              const canRevoke =
                owner ||
                invitation.createdBySubject.tokenIdentifier ===
                  data.actor.subject?.tokenIdentifier ||
                invitation.roleIds.every((id) => assignable.has(id));
              return (
                <div
                  key={invitation._id}
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-sm"
                >
                  <div>
                    <span>
                      {invitation.roleIds
                        .map((id) => roleNames.get(id) ?? "Unavailable role")
                        .join(", ")}
                    </span>
                    <p className="mt-1 text-xs text-muted">
                      {state} ·{" "}
                      {new Date(invitation.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  {state === "pending" && canRevoke ? (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void perform(
                          () => actions.revokeInvite(invitation._id),
                          "Invitation revoked.",
                        )
                      }
                    >
                      Revoke invitation
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card padding="lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle>VRDex roles</SectionTitle>
          {owner ? (
            <Button disabled={busy} onClick={() => setEditing("new")}>
              Create role
            </Button>
          ) : null}
        </div>
        <p className="mt-3 text-sm text-muted">
          VRDex roles control this dashboard. VRChat group roles are managed
          separately.
        </p>
        {editing === "new" ? (
          <RoleEditor
            key="new"
            roles={data.roles}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={(value) =>
              void perform(() => actions.save(value), "Role saved.").then(
                (saved) => {
                  if (saved) setEditing(null);
                },
              )
            }
          />
        ) : null}
        {data.roles.map((role) => (
          <div key={role._id} className="mt-5 border-t border-border pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{role.label}</h3>
                {role.description ? (
                  <p className="mt-1 text-sm text-muted">{role.description}</p>
                ) : null}
                {role.presetKey ? (
                  <p className="mt-1 text-xs text-muted">
                    Started from the{" "}
                    {role.presetKey === "admin"
                      ? "Admin"
                      : role.presetKey === "moderator"
                        ? "Moderator"
                        : "Event Staff"}{" "}
                    preset
                  </p>
                ) : null}
              </div>
              {owner ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => setEditing(role)}
                  >
                    Edit role
                  </Button>
                  <Button
                    size="sm"
                    variant="dangerGhost"
                    disabled={busy}
                    onClick={() => setDeleting(role)}
                  >
                    Delete role
                  </Button>
                </div>
              ) : null}
            </div>
            {editing !== "new" && editing?._id === role._id ? (
              <RoleEditor
                key={role._id}
                role={role}
                roles={data.roles}
                busy={busy}
                onCancel={() => setEditing(null)}
                onSave={(value) =>
                  void perform(() => actions.save(value), "Role saved.").then(
                    (saved) => {
                      if (saved) setEditing(null);
                    },
                  )
                }
              />
            ) : (
              <p className="mt-3 text-xs leading-6 text-muted">
                {role.permissions
                  .map((permission) => permissionLabels[permission])
                  .join(" · ") || "No permissions"}
              </p>
            )}
            {deleting?._id === role._id ? (
              <div className="mt-4 rounded-panel border border-danger/35 p-4">
                <p className="text-sm">
                  Deleting this role removes it from everyone who holds it.
                  Categories visible only to this role become owner only.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    disabled={busy}
                    variant="danger"
                    onClick={async () => {
                      let changed: Array<keyof typeof categoryLabels> = [];
                      const deleted = await perform(async () => {
                        const result = await actions.delete(role._id);
                        if (Array.isArray(result))
                          changed = result.filter(
                            (item): item is keyof typeof categoryLabels =>
                              typeof item === "string" &&
                              item in categoryLabels,
                          );
                      }, "Role deleted.");
                      if (deleted) {
                        setDeleting(null);
                        setEditing(null);
                        if (changed.length)
                          setMessage(
                            `Role deleted. Owner only: ${changed.map((item) => categoryLabels[item]).join(", ")}.`,
                          );
                      }
                    }}
                  >
                    Confirm delete
                  </Button>
                  <Button disabled={busy} onClick={() => setDeleting(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </Card>
      {owner ? (
        <Card padding="lg">
          <SectionHeading>Recent actions</SectionHeading>
          <div className="mt-4 grid gap-3">
            {data.actionLog.map((entry) => (
              <div
                key={entry._id}
                className="flex flex-wrap justify-between gap-3 border-b border-border py-3 text-sm"
              >
                <span>
                  {entry.actorSubject.displayName ?? "Staff member"} ·{" "}
                  {entry.action.replaceAll("_", " ")}
                </span>
                <time
                  className="text-xs text-muted"
                  dateTime={new Date(entry.createdAt).toISOString()}
                >
                  {new Date(entry.createdAt).toLocaleString()}
                </time>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export function ClubStaff() {
  const data = useClubWorkspace();
  const seed = useMutation(api.clubStaff.seedPresetRoles);
  const save = useMutation(api.clubStaff.saveRole);
  const remove = useMutation(api.clubStaff.deleteRole);
  const invite = useMutation(api.clubStaff.createStaffInvitation);
  const revokeInvite = useMutation(api.clubStaff.revokeStaffInvitation);
  const revokeAssignment = useMutation(api.clubStaff.revokeAssignment);
  const communitySlug = data.community.slug;
  return (
    <ClubStaffView
      data={data}
      actions={{
        seed: () => seed({ communitySlug }),
        save: (input) => save({ communitySlug, ...input }),
        delete: (roleId) => remove({ communitySlug, roleId }),
        invite: (roleIds) => invite({ communitySlug, roleIds }),
        revokeInvite: (invitationId) =>
          revokeInvite({ communitySlug, invitationId }),
        revokeAssignment: (assignmentId) =>
          revokeAssignment({ communitySlug, assignmentId }),
      }}
    />
  );
}
