import { REST, Routes } from "discord.js";

import { vrdexCommand } from "./commands";

const token = process.env.DISCORD_BOT_TOKEN;
const applicationId = process.env.DISCORD_APPLICATION_ID;

if (!token || !applicationId) {
  throw new Error("DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID are required to register the VRDex commands.");
}

await new REST().setToken(token).put(Routes.applicationCommands(applicationId), { body: [vrdexCommand.toJSON()] });
console.log(JSON.stringify({ event: "discord_gateway_commands_registered" }));
