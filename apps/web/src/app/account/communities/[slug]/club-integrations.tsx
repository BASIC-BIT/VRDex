"use client";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";
import { GoogleCalendarConnect } from "./club-google-calendar";
import { ClubAccessNotice, useClubWorkspace } from "./club-workspace";
import { DiscordBoardConnect } from "./discord-board-connect";
import { DiscordConnect } from "./discord-connect";
import {
  connectedCalendarIds,
  connectorTargetName,
  directionOptions,
  DIRECTION_HELP,
  KIND_LABELS,
  MODE_LABELS,
  STATE_LABELS,
  syncedLabel,
  type Connector,
} from "./club-integrations-model";

export type ConnectorPatch = Omit<FunctionArgs<typeof api.eventConnectors.update>, "connectorId">;
type ConnectorId = Connector["connectorId"];

function ConnectorRow({
  connector,
  communitySlug,
  now,
  pending,
  run,
  onUpdate,
  onRemove,
}: {
  connector: Connector;
  communitySlug: string;
  now: number;
  pending: boolean;
  run: (action: () => Promise<unknown>) => void;
  onUpdate: (connectorId: ConnectorId, patch: ConnectorPatch) => Promise<unknown>;
  onRemove: (connectorId: ConnectorId) => Promise<unknown>;
}) {
  const helpId = useId();
  const { connectorId, kind, direction, mode, state, lastError } = connector;
  const target = connectorTargetName(connector);
  const synced = syncedLabel(connector.lastSyncedAt, now);
  const help = DIRECTION_HELP[direction];
  const update = (patch: ConnectorPatch) => run(() => onUpdate(connectorId, patch));
  // The state label and Reconnect already say this; lastError would only add an internal code.
  const reconnect = kind === "google_calendar" && state === "needs_reauth";
  return (
    <li className="grid gap-4 py-5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="font-semibold">{KIND_LABELS[kind]}</p>
        {target ? <p className="break-words text-sm text-muted">{target}</p> : null}
        <p className="mt-2 flex flex-wrap gap-x-3 text-sm">
          <span className={cn(state === "active" ? "text-muted" : "font-medium")}>
            {state === "removed" ? null : STATE_LABELS[state]}
          </span>
          {synced ? <span className="text-muted">{synced}</span> : null}
        </p>
        {lastError && !reconnect ? <p className="mt-1 break-words text-sm text-muted">{lastError}</p> : null}
      </div>
      <div className="order-last flex flex-wrap items-start gap-2 sm:order-none sm:col-start-2 sm:row-start-1">
        {state === "paused" ? (
          <Button size="sm" disabled={pending} onClick={() => update({ state: "active" })}>
            Resume
          </Button>
        ) : null}
        {reconnect ? (
          <a
            href={`/api/connectors/google/start?community=${encodeURIComponent(communitySlug)}&connectorId=${encodeURIComponent(connectorId)}`}
            className={buttonVariants({ size: "sm" })}
          >
            Reconnect
          </a>
        ) : null}
        <Button size="sm" variant="dangerGhost" disabled={pending} onClick={() => run(() => onRemove(connectorId))}>
          Disconnect
        </Button>
      </div>
      <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
        <div className="grid min-w-0 content-start gap-2">
          <Select
            aria-label="Direction"
            aria-describedby={help ? helpId : undefined}
            value={direction}
            disabled={pending}
            onChange={(event) => update({ direction: event.target.value as Connector["direction"] })}
          >
            {directionOptions(kind).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          {help ? (
            <p id={helpId} className="text-xs leading-5 text-muted">
              {help}
            </p>
          ) : null}
        </div>
        {direction === "import" || direction === "bidirectional" ? (
          <Select
            aria-label="Mode"
            className="self-start"
            value={mode}
            disabled={pending}
            onChange={(event) => update({ mode: event.target.value as Connector["mode"] })}
          >
            {(Object.keys(MODE_LABELS) as Connector["mode"][]).map((value) => (
              <option key={value} value={value}>
                {MODE_LABELS[value]}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
    </li>
  );
}

export function ClubIntegrationsView({
  communitySlug,
  connectors,
  onUpdate,
  onRemove,
  now,
  connect,
}: {
  communitySlug: string;
  connectors: readonly Connector[];
  onUpdate: (connectorId: ConnectorId, patch: ConnectorPatch) => Promise<unknown>;
  onRemove: (connectorId: ConnectorId) => Promise<unknown>;
  now: number;
  /** Connect controls; the page passes its Convex-backed ones. */
  connect?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const run = (action: () => Promise<unknown>) => {
    setFailed(false);
    setPending(true);
    action().catch(() => setFailed(true)).finally(() => setPending(false));
  };
  // notion is reserved and never renders.
  const rows = connectors.filter((connector) => connector.kind !== "notion");
  return (
    <div className="grid gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">Integrations</h1>
      {failed ? (
        <Notice variant="error" role="alert">
          Try again.
        </Notice>
      ) : null}
      {connect}
      {rows.length ? (
        <Card>
          <ul className="grid divide-y divide-border">
            {rows.map((connector) => (
              <ConnectorRow
                key={connector.connectorId}
                connector={connector}
                communitySlug={communitySlug}
                now={now}
                pending={pending}
                run={run}
                onUpdate={onUpdate}
                onRemove={onRemove}
              />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function ConnectedIntegrations({ communityProfileId, communitySlug }: { communityProfileId: Id<"profiles">; communitySlug: string }) {
  const result = useQuery(api.eventConnectors.listForCommunity, { communityProfileId });
  const update = useMutation(api.eventConnectors.update);
  const remove = useMutation(api.eventConnectors.remove);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (result === undefined) return null;
  if (!result.enabled) return <ClubAccessNotice />;
  return (
    <ClubIntegrationsView
      communitySlug={communitySlug}
      connectors={result.connectors}
      now={now}
      onUpdate={(connectorId, patch) => update({ connectorId, ...patch })}
      onRemove={(connectorId) => remove({ connectorId })}
      connect={
        <>
          <GoogleCalendarConnect connectedCalendarIds={connectedCalendarIds(result.connectors)} />
          <DiscordBoardConnect communityProfileId={communityProfileId} />
          <DiscordConnect communityProfileId={communityProfileId} />
        </>
      }
    />
  );
}

export function ClubIntegrations() {
  const data = useClubWorkspace();
  if (
    data.actor.kind !== "owner" &&
    !data.actor.permissions.includes("manage_integrations")
  )
    return <ClubAccessNotice />;
  if (!data.eventConnectorsEnabled) return <ClubAccessNotice />;
  return <ConnectedIntegrations communityProfileId={data.community._id} communitySlug={data.community.slug} />;
}
