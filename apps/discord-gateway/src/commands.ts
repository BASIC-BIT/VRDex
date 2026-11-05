import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";

import { logFailure, postIntake, requireOk } from "./relay";

const AUTOCOMPLETE_CHOICE_LIMIT = 25;

export const vrdexCommand = new SlashCommandBuilder()
  .setName("vrdex")
  .setDescription("VRDex")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand(subcommand => subcommand
    .setName("connect")
    .setDescription("Connect this channel")
    .addStringOption(option => option.setName("community").setDescription("Community").setRequired(true).setAutocomplete(true))
    .addStringOption(option => option.setName("mode").setDescription("Mode").setRequired(true).addChoices(
      { name: "Hold for review", value: "hold" },
      { name: "Publish automatically", value: "autopublish" },
    ))
    .addIntegerOption(option => option.setName("quiet_window").setDescription("Seconds to wait for edits").setMinValue(30).setMaxValue(600)))
  .addSubcommand(subcommand => subcommand.setName("disconnect").setDescription("Disconnect this channel"))
  .addSubcommand(subcommand => subcommand.setName("status").setDescription("Show this channel's connection"));

type CommandInvocation = {
  subcommand: "connect" | "disconnect" | "status" | "autocomplete";
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
  userId: string;
  memberPermissions: string;
  options: Record<string, string | number>;
};

export function buildCommandRequest({ subcommand, guildId, guildName, channelId, channelName, userId, memberPermissions, options }: CommandInvocation) {
  return {
    command: subcommand,
    guildId,
    channelId,
    invokerDiscordUserId: userId,
    invokerHasManageGuild: new PermissionsBitField(BigInt(memberPermissions)).has(PermissionFlagsBits.ManageGuild),
    options: { ...options, channelName, guildName },
  };
}

async function postCommand<T>(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction,
  subcommand: CommandInvocation["subcommand"],
  options: CommandInvocation["options"],
): Promise<T> {
  const { guild, channel, guildId, channelId, user, memberPermissions } = interaction;
  const response = await postIntake("/discord-intake/command", buildCommandRequest({
    subcommand,
    guildId: guildId!,
    guildName: guild?.name ?? guildId!,
    channelId: channelId!,
    channelName: (channel && "name" in channel && channel.name) || channelId!,
    userId: user.id,
    memberPermissions: memberPermissions?.bitfield.toString() ?? "0",
    options,
  }));
  requireOk(response);
  return await response.json() as T;
}

const logCommandFailure = (error: unknown) => logFailure("discord_gateway_command_failed", error);

export async function handleVrdexInteraction(interaction: ChatInputCommandInteraction | AutocompleteInteraction): Promise<void> {
  try {
    if (interaction.isAutocomplete()) {
      const choices = await postCommand<{ choices: Array<{ name: string; value: string }> }>(interaction, "autocomplete", { query: interaction.options.getFocused() })
        .then(body => body.choices.slice(0, AUTOCOMPLETE_CHOICE_LIMIT))
        .catch((error: unknown) => { logCommandFailure(error); return []; });
      await interaction.respond(choices);
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      // Discord omits unset options, so `quiet_window` is absent here unless the invoker gave it.
      const given = Object.fromEntries((interaction.options.data[0]?.options ?? []).map(({ name, value }) => [name, value as string | number]));
      const { reply } = await postCommand<{ reply: string }>(interaction, interaction.options.getSubcommand() as "connect" | "disconnect" | "status", given);
      await interaction.editReply({ content: reply, allowedMentions: { parse: [] } });
    } catch (error) {
      await interaction.deleteReply();
      throw error;
    }
  } catch (error) {
    logCommandFailure(error);
  }
}
