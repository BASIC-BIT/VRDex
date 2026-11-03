import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import {
  ClubIntegrationsView,
  type ConnectorPatch,
} from "@/app/account/communities/[slug]/club-integrations";
import { GoogleCalendarConnectView } from "@/app/account/communities/[slug]/club-google-calendar";
import type { Connector, GoogleCalendar } from "@/app/account/communities/[slug]/club-integrations-model";
import { VrchatCalendarConnectView } from "@/app/account/communities/[slug]/club-vrchat-calendar";
import { DiscordBoardConnectView } from "@/app/account/communities/[slug]/discord-board-connect";
import { DiscordScheduledEventsConnectView } from "@/app/account/communities/[slug]/discord-scheduled-events-connect";
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

const calendars: GoogleCalendar[] = [
  { id: "afterhours@group.calendar.google.com", summary: "Afterhours events" },
  { id: "host@example.com", summary: "host@example.com", primary: true },
  { id: "late@group.calendar.google.com", summary: "Late night sets and guest DJ rotations across every Afterhours stage" },
];

type GooglePreview = { calendars?: GoogleCalendar[]; enabled?: boolean; failed?: boolean; saveFails?: boolean };
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

function ScheduledEventsConnect({ initial, onConnected }: { initial: { open?: boolean; guildId?: string }; onConnected: (connector: Connector) => void }) {
  const [open, setOpen] = useState(initial.open ?? false);
  const [guildId, setGuildId] = useState(initial.guildId ?? "");
  const [direction, setDirection] = useState<Connector["direction"]>("export");
  const close = () => {
    setGuildId("");
    setDirection("export");
    setOpen(false);
  };
  return (
    <DiscordScheduledEventsConnectView
      open={open}
      guilds={guilds.map((guild) => ({ id: guild.guildId, name: guild.guildName }))}
      guildId={guildId}
      direction={direction}
      pending={false}
      failed={false}
      onToggle={() => (open ? close() : setOpen(true))}
      onGuildChange={setGuildId}
      onDirectionChange={setDirection}
      onConnect={() => {
        const guild = guilds.find((row) => row.guildId === guildId);
        if (!guild) return;
        onConnected(row({
          connectorId: id(`scheduled-${guild.guildId}`), kind: "discord_scheduled_events", direction, mode: "hold", state: "active",
          target: guild,
        }));
        close();
      }}
    />
  );
}

const withoutCalendar = fixtures.filter((connector) => connector.kind !== "vrchat_calendar");

function Preview({ connectors = fixtures, board, scheduledEvents, google, calendar, connectFails = false }: {
  connectors?: Connector[];
  board?: BoardState;
  scheduledEvents?: { open?: boolean; guildId?: string };
  google?: GooglePreview;
  calendar?: { enabled: boolean; ready: boolean };
  connectFails?: boolean;
}) {
  const [rows, setRows] = useState(connectors);
  const [picker, setPicker] = useState(google?.calendars);
  const [submitted, setSubmitted] = useState("");
  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-4 sm:p-6">
      <ClubIntegrationsView
        communitySlug="afterhours"
        connectors={rows}
        now={NOW}
        onUpdate={async (connectorId, patch: ConnectorPatch) => {
          setSubmitted(JSON.stringify({ connectorId, ...patch }));
          setRows((current) => current.map((row) => row.connectorId === connectorId
            ? { ...row, ...patch, ...(patch.state ? { lastError: undefined } : {}) }
            : row));
        }}
        onRemove={async (connectorId) => setRows((current) => current.filter((row) => row.connectorId !== connectorId))}
        vrchatCalendarConnect={
          <VrchatCalendarConnectView
            availability={calendar}
            onConnect={async (direction) => {
              if (connectFails) throw new Error("CONNECTOR_EXISTS");
              setSubmitted(JSON.stringify({ kind: "vrchat_calendar", direction }));
              setRows((current) => [...current, row({ connectorId: id("connected"), kind: "vrchat_calendar", direction, mode: "hold", state: "active", target: { groupId: "grp_afterhours" } })]);
            }}
          />
        }
        connect={<>
          {google ? (
            <GoogleCalendarConnectView
              communitySlug="afterhours"
              enabled={google.enabled ?? true}
              failed={google.failed ?? false}
              calendars={picker}
              onSave={async (target, direction) => {
                if (google.saveFails) {
                  await new Promise((resolve) => setTimeout(resolve, 1_000));
                  throw new Error("CONNECTOR_EXISTS");
                }
                setSubmitted(JSON.stringify({ kind: "google_calendar", direction, mode: "hold", target }));
                setPicker(undefined);
              }}
            />
          ) : null}
          {board ? <BoardConnect initial={board} onConnected={(added) => setRows((current) => [...current, added])} /> : null}
          {scheduledEvents ? <ScheduledEventsConnect initial={scheduledEvents} onConnected={(added) => setRows((current) => [...current, added])} /> : null}
        </>}
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
export const CalendarReady: Story = { args: { connectors: withoutCalendar, calendar: { enabled: true, ready: true } } };
export const CalendarNotReady: Story = { args: { connectors: withoutCalendar, calendar: { enabled: true, ready: false } } };
export const CalendarFlagOff: Story = { args: { connectors: withoutCalendar, calendar: { enabled: false, ready: false } } };
export const CalendarConnectFails: Story = { args: { connectors: [], calendar: { enabled: true, ready: true }, connectFails: true } };
export const GoogleConnect: Story = { args: { connectors: [], google: {} } };
export const GoogleCalendarPicker: Story = { args: { connectors: [], google: { calendars } } };
export const GoogleSaveFails: Story = { args: { connectors: [], google: { calendars, saveFails: true } } };
export const GoogleReconnect: Story = {
  args: {
    google: {},
    connectors: [
      row({
        connectorId: id("google"), kind: "google_calendar", direction: "bidirectional", mode: "hold", state: "needs_reauth",
        target: { calendarId: "afterhours@group.calendar.google.com", calendarName: "Afterhours events" },
        lastSyncedAt: NOW - 3 * 3_600_000, lastError: "GOOGLE_REAUTH_REQUIRED",
      }),
    ],
  },
};
export const GoogleConnectFailed: Story = { args: { connectors: [], google: { failed: true } } };
export const GoogleNoCalendars: Story = { args: { connectors: [], google: { calendars: [] } } };
export const GoogleDisabledFailed: Story = { args: { connectors: [], google: { enabled: false, failed: true } } };
export const BoardClosed: Story = { args: { board: {} } };
export const BoardOpen: Story = { args: { board: { open: true, guildId: "123456789012345678" } } };
export const ScheduledEventsClosed: Story = { args: { scheduledEvents: {} } };
export const ScheduledEventsOpen: Story = { args: { scheduledEvents: { open: true } } };
