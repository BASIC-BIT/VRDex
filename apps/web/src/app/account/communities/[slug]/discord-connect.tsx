"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { MODE_LABELS, type Connector } from "./club-integrations-model";

export type DiscordGuild = { guildId: string; guildName?: string };
export type DiscordChannels = FunctionReturnType<typeof api.discordIntake.listConnectableChannels>;
type Mode = Connector["mode"];

const MODE_HELP: Record<Mode, string> = {
  hold: "New events wait in My events until you approve them.",
  autopublish: "New events and changes go live as soon as they are read.",
};
const connectLink = buttonVariants({ variant: "primary" });

export function DiscordConnectView({
  verifyHref,
  guilds,
  guildId,
  listing,
  channelId,
  mode,
  pending,
  failed,
  onGuildChange,
  onChannelChange,
  onModeChange,
  onConnect,
}: {
  verifyHref: string;
  guilds: readonly DiscordGuild[];
  guildId: string;
  /** Undefined until the chosen server's channels arrive. */
  listing: DiscordChannels | undefined;
  channelId: string;
  mode: Mode;
  pending: boolean;
  failed: boolean;
  onGuildChange: (guildId: string) => void;
  onChannelChange: (channelId: string) => void;
  onModeChange: (mode: Mode) => void;
  onConnect: () => void;
}) {
  const helpId = useId();
  const channels = listing?.state === "ready" ? listing.channels : null;
  const channel = channels?.find((row) => row.channelId === channelId);
  const severalGuilds = guilds.length > 1;
  const invite =
    listing?.state === "bot_missing" ? (
      <a className={`${connectLink} justify-self-start`} href={listing.inviteUrl} target="_blank" rel="noopener">
        Connect Discord
      </a>
    ) : null;
  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">Discord</h2>
      {guilds.length === 0 ? (
        <Link className={`${connectLink} justify-self-start`} href={verifyHref}>
          Connect Discord
        </Link>
      ) : null}
      {severalGuilds || channels ? (
        <Card className="grid max-w-xl gap-4">
          {severalGuilds ? (
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
          ) : null}
          {invite}
          {channels ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                onConnect();
              }}
            >
              <Field>
                Channel
                <Select
                  value={channel ? channelId : ""}
                  disabled={pending}
                  onChange={(event) => onChannelChange(event.target.value)}
                >
                  <option value="" disabled hidden />
                  {channels.map((row) => (
                    <option key={row.channelId} value={row.channelId}>
                      {row.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid min-w-0 gap-2 text-sm">
                <Select
                  aria-label="Mode"
                  aria-describedby={helpId}
                  value={mode}
                  disabled={pending}
                  onChange={(event) => onModeChange(event.target.value as Mode)}
                >
                  {(Object.keys(MODE_LABELS) as Mode[]).map((value) => (
                    <option key={value} value={value}>
                      {MODE_LABELS[value]}
                    </option>
                  ))}
                </Select>
                <p id={helpId} className="text-xs leading-5 text-muted">
                  {MODE_HELP[mode]}
                </p>
              </div>
              <Button type="submit" variant="primary" className="justify-self-start" disabled={pending || !channel}>
                Connect Discord
              </Button>
            </form>
          ) : null}
        </Card>
      ) : (
        invite
      )}
      {failed ? (
        <Notice variant="error" role="alert">
          Try again.
        </Notice>
      ) : null}
    </section>
  );
}

type ConnectArgs = { guildId: string; guildName: string; channelId: string; channelName: string; mode: Mode };

/** The connect flow's state, free of Convex and routing so a story can run it with stubbed calls. */
export function DiscordConnectFlow({
  context,
  pathname,
  listChannels,
  connectChannel,
}: {
  context: { guilds: readonly DiscordGuild[]; preselectedGuildId: string | null };
  pathname: string;
  listChannels: (guildId: string) => Promise<DiscordChannels>;
  connectChannel: (args: ConnectArgs) => Promise<unknown>;
}) {
  const [chosenGuildId, setChosenGuildId] = useState<string>();
  const [listing, setListing] = useState<DiscordChannels>();
  const [channelId, setChannelId] = useState("");
  const [mode, setMode] = useState<Mode>("hold");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const guildId = chosenGuildId ?? context.preselectedGuildId ?? "";

  useEffect(() => {
    if (!guildId) return;
    // Drops a listing that arrives after the server changed. The focus reload picks up a bot invited in another tab.
    let current = true;
    const load = () =>
      listChannels(guildId)
        .then((result) => {
          if (!current) return;
          setListing(result);
          setFailed(false);
        })
        .catch(() => current && setFailed(true));
    load();
    window.addEventListener("focus", load);
    return () => {
      current = false;
      window.removeEventListener("focus", load);
    };
  }, [guildId, listChannels]);

  const chooseGuild = (next: string) => {
    setChosenGuildId(next);
    setListing(undefined);
    setChannelId("");
    setFailed(false);
  };
  const connect = () => {
    const channel = listing?.state === "ready" ? listing.channels.find((row) => row.channelId === channelId) : undefined;
    if (!channel) return;
    setPending(true);
    setFailed(false);
    connectChannel({
      guildId,
      guildName: context.guilds.find((guild) => guild.guildId === guildId)?.guildName ?? guildId,
      channelId: channel.channelId,
      channelName: channel.name,
      mode,
    })
      .then(() => {
        setChannelId("");
        setMode("hold");
      })
      .catch(() => setFailed(true))
      .finally(() => setPending(false));
  };

  return (
    <DiscordConnectView
      verifyHref={`/api/discord/verify/start?returnTo=${encodeURIComponent(pathname)}`}
      guilds={context.guilds}
      guildId={guildId}
      listing={listing}
      channelId={channelId}
      mode={mode}
      pending={pending}
      failed={failed}
      onGuildChange={chooseGuild}
      onChannelChange={setChannelId}
      onModeChange={setMode}
      onConnect={connect}
    />
  );
}

export function DiscordConnect({ communityProfileId }: { communityProfileId: Id<"profiles"> }) {
  const context = useQuery(api.discordIntake.connectContext, { communityProfileId });
  const list = useAction(api.discordIntake.listConnectableChannels);
  const connect = useAction(api.discordIntake.connectChannel);
  const pathname = usePathname();
  const listChannels = useCallback((guildId: string) => list({ communityProfileId, guildId }), [communityProfileId, list]);
  if (!context?.enabled) return null;
  return (
    <DiscordConnectFlow
      context={context}
      pathname={pathname}
      listChannels={listChannels}
      connectChannel={(args) => connect({ communityProfileId, ...args })}
    />
  );
}
