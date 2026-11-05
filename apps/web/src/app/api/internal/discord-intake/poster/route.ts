import { handleDiscordPosterRequest } from "@/lib/server/discord-intake-posters";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const POST = (request: Request) => handleDiscordPosterRequest(request);
