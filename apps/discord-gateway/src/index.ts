import { Client, Events, GatewayIntentBits, type Interaction } from "discord.js";

import { routeMediaInteraction, type DiscordMediaInteractionRoute } from "./mediaControlRouting";

const token = process.env.DISCORD_BOT_TOKEN;

if (token === undefined || token.length === 0) {
  throw new Error("DISCORD_BOT_TOKEN is required to start the VRDex Discord Gateway service.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(JSON.stringify({ event: "discord_gateway_ready", userId: readyClient.user.id }));
});

client.on(Events.InteractionCreate, async (interaction) => {
  const route = routeDiscordInteraction(interaction);

  await acknowledgeInteraction(interaction, route);
});

await client.login(token);

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
