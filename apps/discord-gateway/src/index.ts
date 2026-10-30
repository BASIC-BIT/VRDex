import { randomUUID } from "node:crypto";

import { Client, Events, GatewayIntentBits, Partials, type Interaction } from "discord.js";

import { catchUpMissedMessages } from "./catchUp";
import { handleVrdexInteraction } from "./commands";
import { createConnectorCache } from "./connectorCache";
import { routeMediaInteraction, type DiscordMediaInteractionRoute } from "./mediaControlRouting";
import { fetchConnectors, postIntake, relay, relayConnected, toMessagePayload } from "./relay";

const HEARTBEAT_INTERVAL_MS = 60_000;

const token = process.env.DISCORD_BOT_TOKEN;

if (token === undefined || token.length === 0) {
  throw new Error("DISCORD_BOT_TOKEN is required to start the VRDex Discord Gateway service.");
}

for (const name of ["CONVEX_SITE_URL", "DISCORD_INTAKE_SECRET"]) {
  if (!process.env[name]) {
    throw new Error(`${name} is required to start the VRDex Discord Gateway service.`);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildScheduledEvents],
  partials: [Partials.Message],
});
const connectors = createConnectorCache({ fetchConnectors });

client.once(Events.ClientReady, (readyClient) => {
  console.log(JSON.stringify({ event: "discord_gateway_ready", userId: readyClient.user.id }));
  catchUpMissedMessages({ fetchConnectors, fetchMessagesAfter, relay })
    .then(relayed => console.log(JSON.stringify({ event: "discord_gateway_catch_up_complete", relayed })))
    .catch(() => console.error(JSON.stringify({ event: "discord_gateway_catch_up_failed" })));
});

client.on(Events.MessageCreate, message => relayConnected(connectors.get, "create", message, () => toMessagePayload(message)));
client.on(Events.MessageUpdate, (_previous, message) =>
  relayConnected(connectors.get, "update", message, async () => toMessagePayload(message.partial ? await message.fetch() : message)));
client.on(Events.MessageDelete, message => relayConnected(connectors.get, "delete", message, () => ({ messageId: message.id })));

client.on(Events.InteractionCreate, async (interaction) => {
  if ((interaction.isChatInputCommand() || interaction.isAutocomplete()) && interaction.commandName === "vrdex") {
    await handleVrdexInteraction(interaction);
    return;
  }

  const route = routeDiscordInteraction(interaction);

  await acknowledgeInteraction(interaction, route);
});

await client.login(token);

const instanceId = randomUUID();
void sendHeartbeat();
setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

async function sendHeartbeat(): Promise<void> {
  try {
    const response = await postIntake("/discord-intake/heartbeat", { instanceId, at: Date.now() });
    if (!response.ok) throw new Error(`Discord intake heartbeat answered ${response.status}.`);
  } catch {
    console.error(JSON.stringify({ event: "discord_gateway_heartbeat_failed" }));
  }
}

async function fetchMessagesAfter(channelId: string, afterId: string) {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error("Connected channel is not text based.");
  return [...(await channel.messages.fetch({ after: afterId, limit: 100 })).values()];
}

function routeDiscordInteraction(interaction: Interaction): DiscordMediaInteractionRoute {
  if (interaction.isButton()) {
    return routeMediaInteraction({ kind: "button", customId: interaction.customId });
  }

  if (interaction.isStringSelectMenu()) {
    const selectedSourceKey = interaction.values[0];

    return routeMediaInteraction({
      kind: "select",
      customId: interaction.customId,
      ...(selectedSourceKey === undefined ? {} : { targetSourceKey: selectedSourceKey }),
    });
  }

  if (interaction.isModalSubmit()) {
    return routeMediaInteraction({ kind: "modal", customId: interaction.customId });
  }

  if (interaction.isChatInputCommand()) {
    return routeMediaInteraction({ kind: "slash" });
  }

  return routeMediaInteraction({ kind: "slash", customId: "unknown" });
}

async function acknowledgeInteraction(interaction: Interaction, route: DiscordMediaInteractionRoute): Promise<void> {
  if (!interaction.isRepliable()) {
    return;
  }

  if (route.ack === "defer_message_update" && interaction.isMessageComponent()) {
    await interaction.deferUpdate();
    return;
  }

  if (route.ack === "defer_ephemeral_reply") {
    await interaction.deferReply({ ephemeral: true });
    return;
  }

  await interaction.reply({
    ephemeral: true,
    content: route.reason ?? "VRDex media control request was not routed.",
  });
}
