"use client";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useState } from "react";
import { api } from "@convex-generated-api";
import { Button } from "@/components/ui/button";
import { Card, SectionHeading } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { ClubConnectionFeatures } from "./club-connection-features";
import {
  ClubAccessNotice,
  useClubWorkspace,
  type WorkspaceData,
} from "./club-workspace";

export function ClubConnectionView({
  data,
  connect,
  disconnect,
}: {
  data: WorkspaceData;
  connect: (
    input: FunctionArgs<typeof api.communityTelemetry.connectGroup>,
  ) => Promise<unknown>;
  disconnect: (
    input: FunctionArgs<typeof api.communityTelemetry.disconnectGroup>,
  ) => Promise<unknown>;
}) {
  const [groupId, setGroupId] = useState(data.integration?.vrchatGroupId ?? "");
  const [joinPolicy, setJoinPolicy] = useState<"free" | "request" | "invite">(
    data.integration?.joinPolicy === "free" ||
      data.integration?.joinPolicy === "invite"
      ? data.integration.joinPolicy
      : "request",
  );
  const [groupVisibility, setGroupVisibility] = useState<"public" | "private">(
    data.integration?.groupVisibility === "public" ? "public" : "private",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  async function perform(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    setFailed(false);
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error ? error.message : "The telemetry change failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (
    data.actor.kind !== "owner" &&
    !data.actor.permissions.includes("manage_integrations")
  )
    return <ClubAccessNotice />;
  const integration = data.integration;
  const reconnecting = integration?.state === "disconnected";
  return (
    <div className="grid gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">
        Group connection
      </h1>
      {message ? (
        <Notice
          variant={failed ? "error" : "success"}
          role={failed ? "alert" : "status"}
        >
          {message}
        </Notice>
      ) : null}
      {!integration || reconnecting ? (
        <Card padding="lg" surface="strong">
          <SectionHeading description="VRDex assigns one of its own service accounts. Your VRChat credentials are never requested.">
            {reconnecting ? "Reconnect VRChat group" : "Connect VRChat group"}
          </SectionHeading>
          <form
            className="mt-7 grid gap-5 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(
                () =>
                  connect({
                    communitySlug: data.community.slug,
                    vrchatGroupId: groupId,
                    joinPolicy,
                    groupVisibility,
                  }),
                "Connection requested.",
              );
            }}
          >
            <Field className="md:col-span-2">
              Primary VRChat group ID
              <Input
                onChange={(event) => setGroupId(event.target.value)}
                placeholder="grp_…"
                required
                value={groupId}
              />
            </Field>
            <Field>
              Group visibility
              <Select
                onChange={(event) =>
                  setGroupVisibility(
                    event.target.value as typeof groupVisibility,
                  )
                }
                value={groupVisibility}
              >
                <option value="private">Private</option>
                <option value="public">Public</option>
              </Select>
            </Field>
            <Field>
              Join policy
              <Select
                onChange={(event) =>
                  setJoinPolicy(event.target.value as typeof joinPolicy)
                }
                value={joinPolicy}
              >
                <option value="free">Free join</option>
                <option value="request">Request to join</option>
                <option value="invite">Invite only</option>
              </Select>
            </Field>
            <Button disabled={busy} type="submit">
              {reconnecting ? "Reconnect group" : "Connect group"}
            </Button>
          </form>
        </Card>
      ) : (
        <Card padding="lg" surface="strong">
          <SectionHeading description="Disconnect stops collection and public presentation immediately. Existing private history is retained.">
            Connection
          </SectionHeading>
          <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">State</dt>
              <dd className="mt-1">{integration.state.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt className="text-muted">Primary VRChat group ID</dt>
              <dd className="mt-1 break-all">{integration.vrchatGroupId}</dd>
            </div>
            <div>
              <dt className="text-muted">Service account</dt>
              <dd className="mt-1 break-all">
                {integration.collector?.vrchatUserId ?? "Unassigned"}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Join policy</dt>
              <dd className="mt-1">{integration.joinPolicy}</dd>
            </div>
          </dl>
          {integration.state === "awaiting_approval" ? (
            <Notice className="mt-5" variant="warning">
              Approve the pending service-account membership request in VRChat
              to begin collection.
            </Notice>
          ) : null}
          {integration.state === "awaiting_invite" ? (
            <Notice className="mt-5" variant="warning">
              Invite service account{" "}
              {integration.collector?.vrchatUserId ?? "shown above"} to this
              VRChat group.
            </Notice>
          ) : null}
          <Button
            className="mt-7"
            disabled={busy || integration.state === "disconnecting"}
            onClick={() =>
              void perform(
                () => disconnect({ communitySlug: data.community.slug }),
                "Disconnect requested.",
              )
            }
          >
            {integration.state === "disconnecting"
              ? "Disconnecting"
              : "Disconnect"}
          </Button>
        </Card>
      )}
      {data.actor.kind === "owner" ? (
        <Link
          className="text-sm underline underline-offset-4"
          href={`/${encodeURIComponent(data.community.slug)}/edit`}
        >
          Edit additional group links
        </Link>
      ) : null}
    </div>
  );
}

export function ClubConnection() {
  const data = useClubWorkspace();
  const connect = useMutation(api.communityTelemetry.connectGroup);
  const disconnect = useMutation(api.communityTelemetry.disconnectGroup);
  const allowed =
    data.actor.kind === "owner" ||
    data.actor.permissions.includes("manage_integrations");
  const connection = useQuery(
    api.clubConnection.get,
    allowed ? { communityProfileId: data.community._id } : "skip",
  );
  const setFeatures = useMutation(api.clubConnection.setFeatures);
  const setRoles = useMutation(api.clubConnection.setProviderRoleAllowlist);
  return (
    <div className="grid gap-6">
      <ClubConnectionView
        data={data}
        connect={connect}
        disconnect={disconnect}
      />
      {allowed && connection ? (
        <ClubConnectionFeatures
          data={data}
          connection={connection}
          actions={{ setFeatures, setRoles }}
        />
      ) : null}
    </div>
  );
}
