import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { ClubIntegrationsView } from "@/app/account/communities/[slug]/club-integrations";
import type { Connector } from "@/app/account/communities/[slug]/club-integrations-model";
import { ClubWorkspaceView, type WorkspaceData } from "@/app/account/communities/[slug]/club-workspace";
import { DiscordConnectFlow, type DiscordChannels, type DiscordGuild } from "@/app/account/communities/[slug]/discord-connect";
import { PageContainer, PageShell } from "@/components/ui/page-shell";

const GUILDS: DiscordGuild[] = [
  { guildId: "123456789012345678", guildName: "Afterhours" },
  { guildId: "223456789012345678", guildName: "Afterhours Staff" },
];
const PATHNAME = "/account/communities/afterhours/integrations";
const INVITE = `https://discord.com/oauth2/authorize?client_id=700000000000000001&scope=bot+applications.commands&permissions=17600776072192&guild_id=${GUILDS[0].guildId}&disable_guild_select=true`;
const BOT_MISSING: DiscordChannels = { state: "bot_missing", inviteUrl: INVITE };
const READY: DiscordChannels = {
  state: "ready",
  channels: [
    { channelId: "323456789012345678", name: "announcements" },
    { channelId: "423456789012345678", name: "upcoming-events" },
  ],
};

// Every stubbed call waits here until the spec settles it, so a spec can hold one in flight.
type Held = { args: unknown; resolve: (value?: unknown) => void; reject: () => void };
const held = { lists: [] as Held[], connects: [] as Held[], updates: [] as Held[] };
if (typeof window !== "undefined") Object.assign(window, { discordConnectHeld: held });
const hold = <T,>(calls: Held[], args: unknown) =>
  new Promise<T>((resolve, reject) => {
    calls.push({ args, resolve: resolve as Held["resolve"], reject: () => reject(new Error("stubbed")) });
  });
const heldList = (guildId: string) => hold<DiscordChannels>(held.lists, guildId);
const heldConnect = (args: unknown) => hold(held.connects, args);

function Flow({ guilds, preselectedGuildId = null, listing }: { guilds: DiscordGuild[]; preselectedGuildId?: string | null; listing?: DiscordChannels }) {
  const [listChannels] = useState(() => (listing ? async () => listing : heldList));
  return <DiscordConnectFlow context={{ guilds, preselectedGuildId }} pathname={PATHNAME} listChannels={listChannels} connectChannel={heldConnect} />;
}

function Preview(props: Parameters<typeof Flow>[0]) {
  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-4 sm:p-6">
      <Flow {...props} />
    </div>
  );
}

const WORKSPACE = {
  community: { _id: "fixture-club", slug: "afterhours", displayName: "Afterhours" },
  actor: { kind: "owner", permissions: [] },
  readableCategories: [],
  eventConnectorsEnabled: true,
} as unknown as WorkspaceData;
const ROWS: Connector[] = [
  {
    connectorId: "board" as Connector["connectorId"], kind: "discord_board", direction: "export", mode: "hold", state: "paused",
    target: { guildId: GUILDS[0].guildId, channelId: "523456789012345678", channelName: "upcoming-events" }, lastSyncedAt: undefined, lastError: undefined,
  },
  {
    connectorId: "calendar" as Connector["connectorId"], kind: "google_calendar", direction: "import", mode: "hold", state: "active",
    target: { calendarId: "afterhours@group.calendar.google.com", calendarName: "Afterhours events" }, lastSyncedAt: undefined, lastError: undefined,
  },
];

/** The Integrations route's content in the real workspace shell; only the page's sign-in and data hooks are absent. */
function IntegrationsPage(props: Parameters<typeof Flow>[0]) {
  return (
    <PageShell>
      <PageContainer max="7xl">
        <ClubWorkspaceView data={WORKSPACE} pathname={PATHNAME}>
          <ClubIntegrationsView
            communitySlug={WORKSPACE.community.slug}
            connectors={ROWS}
            now={0}
            onUpdate={(connectorId, patch) => hold(held.updates, { connectorId, ...patch })}
            onRemove={(connectorId) => hold(held.updates, { connectorId })}
            connect={<Flow {...props} />}
          />
        </ClubWorkspaceView>
      </PageContainer>
    </PageShell>
  );
}

const meta = {
  title: "Clubs/Integrations/Discord connect",
  component: Preview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NoServers: Story = { args: { guilds: [] } };
export const BotMissing: Story = { args: { guilds: GUILDS.slice(0, 1), preselectedGuildId: GUILDS[0].guildId, listing: BOT_MISSING } };
export const ChooseServer: Story = { args: { guilds: GUILDS, listing: BOT_MISSING } };
export const Ready: Story = { args: { guilds: GUILDS.slice(0, 1), preselectedGuildId: GUILDS[0].guildId, listing: READY } };
export const ReadySeveralServers: Story = { args: { guilds: GUILDS, preselectedGuildId: GUILDS[0].guildId, listing: READY } };
export const HeldOneServer: Story = { args: { guilds: GUILDS.slice(0, 1), preselectedGuildId: GUILDS[0].guildId } };
export const HeldSeveralServers: Story = { args: { guilds: GUILDS, preselectedGuildId: GUILDS[0].guildId } };
export const InIntegrationsPage: Story = { args: { guilds: [] }, render: (args) => <IntegrationsPage {...args} /> };
export const InIntegrationsPageReady: Story = { args: { guilds: GUILDS.slice(0, 1), preselectedGuildId: GUILDS[0].guildId, listing: READY }, render: (args) => <IntegrationsPage {...args} /> };
