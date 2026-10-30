import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { DiscordConnectView, type DiscordChannels, type DiscordGuild } from "@/app/account/communities/[slug]/discord-connect";

const GUILDS: DiscordGuild[] = [
  { guildId: "123456789012345678", guildName: "Afterhours" },
  { guildId: "223456789012345678", guildName: "Afterhours Staff" },
];
const INVITE = `https://discord.com/oauth2/authorize?client_id=700000000000000001&scope=bot+applications.commands&permissions=17600776072192&guild_id=${GUILDS[0].guildId}&disable_guild_select=true`;
const READY: DiscordChannels = {
  state: "ready",
  channels: [
    { channelId: "323456789012345678", name: "announcements" },
    { channelId: "423456789012345678", name: "upcoming-events" },
  ],
};

function Preview({ guilds, guildId = "", listing }: { guilds: DiscordGuild[]; guildId?: string; listing?: DiscordChannels }) {
  const [chosen, setChosen] = useState(guildId);
  const [channelId, setChannelId] = useState("");
  const [mode, setMode] = useState<"hold" | "autopublish">("hold");
  const [submitted, setSubmitted] = useState("");
  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-4 sm:p-6">
      <DiscordConnectView
        verifyHref="/api/discord/verify/start?returnTo=%2Faccount%2Fcommunities%2Fafterhours%2Fintegrations"
        guilds={guilds}
        guildId={chosen}
        listing={chosen ? listing : undefined}
        channelId={channelId}
        mode={mode}
        pending={false}
        failed={false}
        onGuildChange={setChosen}
        onChannelChange={setChannelId}
        onModeChange={setMode}
        onConnect={() => setSubmitted(JSON.stringify({ guildId: chosen, channelId, mode }))}
      />
      <output aria-label="Submitted connection" className="sr-only">{submitted}</output>
    </div>
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
export const BotMissing: Story = { args: { guilds: GUILDS.slice(0, 1), guildId: GUILDS[0].guildId, listing: { state: "bot_missing", inviteUrl: INVITE } } };
export const ChooseServer: Story = { args: { guilds: GUILDS, listing: { state: "bot_missing", inviteUrl: INVITE } } };
export const Ready: Story = { args: { guilds: GUILDS.slice(0, 1), guildId: GUILDS[0].guildId, listing: READY } };
export const ReadySeveralServers: Story = { args: { guilds: GUILDS, guildId: GUILDS[0].guildId, listing: READY } };
