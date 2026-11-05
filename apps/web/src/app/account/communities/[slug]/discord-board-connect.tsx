"use client";
import { useId, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export type BoardGuild = { guildId: string; guildName?: string };
export type BoardChannel = { id: string; name: string };

export function DiscordBoardConnectView({
  open,
  guilds,
  guildId,
  channels,
  channelId,
  pending,
  failed,
  onToggle,
  onGuildChange,
  onChannelChange,
  onConnect,
}: {
  open: boolean;
  guilds: readonly BoardGuild[];
  guildId: string;
  /** Undefined until the chosen server's channels arrive. */
  channels: readonly BoardChannel[] | undefined;
  channelId: string;
  pending: boolean;
  failed: boolean;
  onToggle: () => void;
  onGuildChange: (guildId: string) => void;
  onChannelChange: (channelId: string) => void;
  onConnect: () => void;
}) {
  const formId = useId();
  return (
    <div className="grid justify-items-start gap-4">
      <Button aria-expanded={open} aria-controls={open ? formId : undefined} onClick={onToggle}>
        Event board
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
              <Select value={guildId} disabled={pending} onChange={(event) => onGuildChange(event.target.value)}>
                <option value="" disabled hidden />
                {guilds.map((guild) => (
                  <option key={guild.guildId} value={guild.guildId}>
                    {guild.guildName ?? guild.guildId}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              Channel
              <Select
                value={channelId}
                disabled={pending || channels === undefined}
                onChange={(event) => onChannelChange(event.target.value)}
              >
                <option value="" disabled hidden />
                {(channels ?? []).map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="primary" disabled={pending || !guildId || !channelId}>
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

export function DiscordBoardConnect({ communityProfileId }: { communityProfileId: Id<"profiles"> }) {
  const enabled = useQuery(api.eventSyncKinds.discordBoard.isEnabled, {});
  const guilds = useQuery(api.discordVerification.getManageableGuilds, enabled ? {} : "skip");
  const listChannels = useAction(api.eventSyncKinds.discordBoard.listBoardChannels);
  const create = useMutation(api.eventConnectors.create);
  const [open, setOpen] = useState(false);
  const [guildId, setGuildId] = useState("");
  const [channels, setChannels] = useState<BoardChannel[]>();
  const [channelId, setChannelId] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // Drops a channel list that arrives after the server changed again.
  const request = useRef(0);
  if (!enabled) return null;

  const chooseGuild = (next: string) => {
    const current = ++request.current;
    setGuildId(next);
    setChannels(undefined);
    setChannelId("");
    setFailed(false);
    if (!next) return;
    listChannels({ communityProfileId, guildId: next })
      .then((rows) => request.current === current && setChannels(rows))
      .catch(() => request.current === current && setFailed(true));
  };
  const toggle = () => {
    if (open) chooseGuild("");
    setOpen(!open);
  };
  const connect = () => {
    const channel = channels?.find((row) => row.id === channelId);
    if (!guildId || !channel) return;
    setPending(true);
    setFailed(false);
    create({
      communityProfileId,
      kind: "discord_board",
      direction: "export",
      mode: "hold",
      target: { guildId, channelId: channel.id, channelName: channel.name },
    })
      .then(() => {
        chooseGuild("");
        setOpen(false);
      })
      .catch(() => setFailed(true))
      .finally(() => setPending(false));
  };

  return (
    <DiscordBoardConnectView
      open={open}
      guilds={guilds ?? []}
      guildId={guildId}
      channels={channels}
      channelId={channelId}
      pending={pending}
      failed={failed}
      onToggle={toggle}
      onGuildChange={chooseGuild}
      onChannelChange={setChannelId}
      onConnect={connect}
    />
  );
}
