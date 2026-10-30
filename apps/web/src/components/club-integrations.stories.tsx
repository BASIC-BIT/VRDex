import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import {
  ClubIntegrationsView,
  type ConnectorPatch,
} from "@/app/account/communities/[slug]/club-integrations";
import type { Connector } from "@/app/account/communities/[slug]/club-integrations-model";
import { DiscordBoardConnectView } from "@/app/account/communities/[slug]/discord-board-connect";
import type { Id } from "../../../../convex/_generated/dataModel";

const NOW = Date.UTC(2026, 9, 29, 12);
const id = (value: string) => value as Id<"eventConnectors">;
type Optional = "lastSyncedAt" | "lastError";
const row = (connector: Omit<Connector, Optional> & Partial<Pick<Connector, Optional>>): Connector =>
  ({ lastSyncedAt: undefined, lastError: undefined, ...connector });
const fixtures: Connector[] = [
  row({
    connectorId: id("google"), kind: "google_calendar", direction: "bidirectional", mode: "hold", state: "active",
    target: { calendarId: "afterhours@group.calendar.google.com", calendarName: "Afterhours events" }, lastSyncedAt: NOW - 5 * 60_000,
  }),
  row({
    connectorId: id("board"), kind: "discord_board", direction: "export", mode: "hold", state: "paused",
    target: { guildId: "123456789012345678", channelId: "223456789012345678", channelName: "#upcoming-events", guildName: "Afterhours" },
    lastSyncedAt: NOW - 2 * 86_400_000, lastError: "Missing Access",
  }),
  row({
    connectorId: id("scheduled"), kind: "discord_scheduled_events", direction: "import", mode: "autopublish", state: "needs_reauth",
    target: { guildId: "123456789012345678", guildName: "Afterhours" }, lastSyncedAt: NOW - 3 * 3_600_000,
  }),
  row({
    connectorId: id("announcements"), kind: "discord_announcements", direction: "import", mode: "hold", state: "active",
    target: { guildId: "123456789012345678", channelId: "323456789012345678", channelName: "#announcements" }, lastSyncedAt: NOW - 30_000,
  }),
  row({
    connectorId: id("vrchat"), kind: "vrchat_calendar", direction: "off", mode: "hold", state: "active",
    target: { groupId: "grp_afterhours", groupName: "Afterhours" },
  }),
  row({ connectorId: id("notion"), kind: "notion", direction: "off", mode: "hold", state: "active", target: {} }),
];

const guilds = [
  { guildId: "123456789012345678", guildName: "Afterhours" },
  { guildId: "423456789012345678", guildName: "Afterhours Staff" },
];
const channelsByGuild: Record<string, { id: string; name: string }[]> = {
  "123456789012345678": [
    { id: "523456789012345678", name: "announcements" },
    { id: "623456789012345678", name: "upcoming-events" },
  ],
  "423456789012345678": [{ id: "723456789012345678", name: "staff-board" }],
};

type BoardState = { open?: boolean; guildId?: string; channelId?: string };
function BoardConnect({ initial, onConnected }: { initial: BoardState; onConnected: (connector: Connector) => void }) {
  const [open, setOpen] = useState(initial.open ?? false);
  const [guildId, setGuildId] = useState(initial.guildId ?? "");
  const [channelId, setChannelId] = useState(initial.channelId ?? "");
  const channels = guildId ? channelsByGuild[guildId] : undefined;
  const reset = () => {
    setGuildId("");
    setChannelId("");
  };
  return (
    <DiscordBoardConnectView
      open={open}
      guilds={guilds}
      guildId={guildId}
      channels={channels}
      channelId={channelId}
      pending={false}
      failed={false}
      onToggle={() => {
        reset();
        setOpen(!open);
      }}
      onGuildChange={(next) => {
        setGuildId(next);
        setChannelId("");
      }}
      onChannelChange={setChannelId}
      onConnect={() => {
        const channel = channels?.find((row) => row.id === channelId);
        if (!channel) return;
        onConnected(row({
          connectorId: id(`board-${channel.id}`), kind: "discord_board", direction: "export", mode: "hold", state: "active",
          target: { guildId, channelId: channel.id, channelName: channel.name },
        }));
        reset();
        setOpen(false);
      }}
    />
  );
}

function Preview({ connectors = fixtures, board }: { connectors?: Connector[]; board?: BoardState }) {
  const [rows, setRows] = useState(connectors);
  const [submitted, setSubmitted] = useState("");
  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-4 sm:p-6">
      <ClubIntegrationsView
        connectors={rows}
        now={NOW}
        onUpdate={async (connectorId, patch: ConnectorPatch) => {
          setSubmitted(JSON.stringify({ connectorId, ...patch }));
          setRows((current) => current.map((row) => row.connectorId === connectorId
            ? { ...row, ...patch, ...(patch.state ? { lastError: undefined } : {}) }
            : row));
        }}
        onRemove={async (connectorId) => setRows((current) => current.filter((row) => row.connectorId !== connectorId))}
        connect={board ? <BoardConnect initial={board} onConnected={(added) => setRows((current) => [...current, added])} /> : undefined}
      />
      <output aria-label="Submitted connector update" className="sr-only">{submitted}</output>
    </div>
  );
}

const meta = {
  title: "Clubs/Integrations",
  component: Preview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Connectors: Story = {};
export const Empty: Story = { args: { connectors: [] } };
export const BoardClosed: Story = { args: { board: {} } };
export const BoardOpen: Story = { args: { board: { open: true, guildId: "123456789012345678" } } };
