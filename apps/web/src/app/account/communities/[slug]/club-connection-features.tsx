"use client";

import { useEffect, useState } from "react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@convex-generated-api";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { CheckboxField, Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import type { WorkspaceData } from "./club-workspace";

export type ConnectionFeatures = NonNullable<
  FunctionReturnType<typeof api.clubConnection.get>
>;
type Actions = {
  setFeatures: (
    args: FunctionArgs<typeof api.clubConnection.setFeatures>,
  ) => Promise<unknown>;
  setRoles: (
    args: FunctionArgs<typeof api.clubConnection.setProviderRoleAllowlist>,
  ) => Promise<unknown>;
};
const labels = {
  analytics: "Analytics",
  membership_management: "Member management",
  posts: "Posts",
  instances: "Instances",
};
const permissionLabels: Record<string, string> = {
  "group-members-manage": "Manage group member data",
  "group-announcement-manage": "Manage group announcements",
  "group-instance-open-create": "Create members-only instances",
};

function RoleAllowlist({
  role,
  communityProfileId,
  save,
}: {
  role: ConnectionFeatures["roles"][number];
  communityProfileId: WorkspaceData["community"]["_id"];
  save: Actions["setRoles"];
}) {
  const [value, setValue] = useState(role.providerRoleIds.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-3 border-t border-border pt-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await save({
            communityProfileId,
            roleId: role.roleId,
            providerRoleIds: value.split(/[\s,]+/).filter(Boolean),
          });
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : "Unable to save roles.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field>
        {role.label}: permitted VRChat role IDs
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="grol_…"
        />
      </Field>
      <Button
        type="submit"
        size="sm"
        disabled={busy}
        className="justify-self-start"
      >
        Save roles
      </Button>
      {error ? (
        <Notice variant="error" role="alert">
          {error}
        </Notice>
      ) : null}
    </form>
  );
}

export function ClubConnectionFeatures({
  data,
  connection,
  actions,
}: {
  data: WorkspaceData;
  connection: ConnectionFeatures;
  actions: Actions;
}) {
  const [now, setNow] = useState(Date.now);
  const observedAt = connection.authority?.observedAt;
  useEffect(() => {
    if (observedAt === undefined) return;
    const timeout = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, observedAt + 60_001 - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [observedAt]);
  const currentTime = Math.max(now, Date.now());
  const fresh =
    observedAt !== undefined &&
    observedAt <= currentTime &&
    currentTime - observedAt <= 60_000;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (
    data.actor.kind !== "owner" &&
    !data.actor.permissions.includes("manage_integrations")
  )
    return null;
  return (
    <>
      <Card padding="lg">
        <SectionTitle>Enabled features</SectionTitle>
        <div className="mt-5 grid gap-4">
          {connection.features.map((feature) => (
            <div key={feature.feature} className="border-t border-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CheckboxField
                  checked={feature.enabled}
                  disabled={busy}
                  onChange={async (event) => {
                    const enabledFeatures = event.target.checked
                      ? [...connection.enabledFeatures, feature.feature]
                      : connection.enabledFeatures.filter(
                          (id) => id !== feature.feature,
                        );
                    setBusy(true);
                    setError(null);
                    try {
                      await actions.setFeatures({
                        communityProfileId: data.community._id,
                        enabledFeatures,
                      });
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Unable to save features.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {labels[feature.feature]}
                </CheckboxField>
                <span className="text-xs text-muted">
                  {!feature.enabled
                    ? "Disabled"
                    : !fresh
                      ? "Awaiting permission check"
                      : feature.ready
                        ? "Connected"
                        : "Action needed"}
                </span>
              </div>
              {feature.enabled &&
              fresh &&
              feature.missingPermissions.length > 0 ? (
              <ul aria-label="Required permissions" className="mt-3 list-inside list-disc text-sm text-muted">
                  {feature.missingPermissions.map((permission) => (
                    <li key={permission}>
                      {permissionLabels[permission] ?? permission}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
        {error ? (
          <Notice className="mt-4" variant="error" role="alert">
            {error}
          </Notice>
        ) : null}
      </Card>
      {data.actor.kind === "owner" && connection.roles.length > 0 ? (
        <Card padding="lg">
          <SectionTitle>VRChat role assignments</SectionTitle>
          <div className="mt-5 grid gap-5">
            {connection.roles.map((role) => (
              <RoleAllowlist
                key={role.roleId}
                role={role}
                communityProfileId={data.community._id}
                save={actions.setRoles}
              />
            ))}
          </div>
        </Card>
      ) : null}
    </>
  );
}
