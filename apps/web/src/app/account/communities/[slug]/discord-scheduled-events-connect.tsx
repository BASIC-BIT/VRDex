"use client";
import { useId, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { directionOptions, type Connector } from "./club-integrations-model";

export type ConnectableGuild = { id: string; name: string };
type Direction = Connector["direction"];

export function DiscordScheduledEventsConnectView({
  open,
  guilds,
  guildId,
  direction,
  pending,
  failed,
  onToggle,
  onGuildChange,
  onDirectionChange,
  onConnect,
}: {
  open: boolean;
  /** Undefined until the server list arrives. */
  guilds: readonly ConnectableGuild[] | undefined;
  guildId: string;
  direction: Direction;
  pending: boolean;
  failed: boolean;
  onToggle: () => void;
  onGuildChange: (guildId: string) => void;
  onDirectionChange: (direction: Direction) => void;
  onConnect: () => void;
}) {
  const formId = useId();
  return (
    <div className="grid justify-items-start gap-4">
      <Button aria-expanded={open} aria-controls={open ? formId : undefined} onClick={onToggle}>
        Discord events
      </Button>
      {open ? (
        <Card id={formId} className="w-full">
          <form
            className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              onConnect();
            }}
          >
            <Field>
              Server
              <Select
                value={guildId}
                disabled={pending || guilds === undefined}
                onChange={(event) => onGuildChange(event.target.value)}
              >
                <option value="" disabled hidden />
                {(guilds ?? []).map((guild) => (
                  <option key={guild.id} value={guild.id}>
                    {guild.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              Direction
              <Select
                value={direction}
                disabled={pending}
                onChange={(event) => onDirectionChange(event.target.value as Direction)}
              >
                {directionOptions("discord_scheduled_events").map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="primary" disabled={pending || !guildId}>
              Connect
            </Button>
          </form>
          {failed ? (
            <Notice variant="error" role="alert" className="mt-4">
              Try again.
            </Notice>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

export function DiscordScheduledEventsConnect({ communityProfileId }: { communityProfileId: Id<"profiles"> }) {
  const enabled = useQuery(api.eventSyncKinds.discordScheduledEvents.isEnabled, {});
  const listGuilds = useAction(api.eventSyncKinds.discordScheduledEvents.listConnectableGuilds);
  const create = useMutation(api.eventConnectors.create);
  const [open, setOpen] = useState(false);
  const [guilds, setGuilds] = useState<ConnectableGuild[]>();
  const [guildId, setGuildId] = useState("");
  const [direction, setDirection] = useState<Direction>("export");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!enabled) return null;

  const toggle = () => {
    setGuilds(undefined);
    setGuildId("");
    setDirection("export");
    setFailed(false);
    setOpen(!open);
    if (open) return;
    listGuilds({ communityProfileId })
      .then(setGuilds)
      .catch(() => setFailed(true));
  };
  const connect = () => {
    const guild = guilds?.find((row) => row.id === guildId);
    if (!guild) return;
    setPending(true);
    setFailed(false);
    create({
      communityProfileId,
      kind: "discord_scheduled_events",
      direction,
      mode: "hold",
      target: { guildId: guild.id, guildName: guild.name },
    })
      .then(toggle)
      .catch(() => setFailed(true))
      .finally(() => setPending(false));
  };

  return (
    <DiscordScheduledEventsConnectView
      open={open}
      guilds={guilds}
      guildId={guildId}
      direction={direction}
      pending={pending}
      failed={failed}
      onToggle={toggle}
      onGuildChange={setGuildId}
      onDirectionChange={setDirection}
      onConnect={connect}
    />
  );
}
