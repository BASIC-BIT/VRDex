const DISCORD_API_BASE = "https://discord.com/api/v10";
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_SECONDS = 5;

// View Channel 1<<10, Send Messages 1<<11, Manage Messages 1<<13, Embed Links 1<<14, Read Message History 1<<16, Manage Events 1<<33, Create Events 1<<44.
export const DISCORD_BOT_PERMISSIONS = 17600776072192;

/** Calls the Discord REST API as the bot. Errors are short codes; they never carry the token or a response body. */
export async function discordRequest(request: { method: string; path: string; body?: unknown; token?: string }): Promise<Response> {
  const token = request.token ?? process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN_MISSING");
  const init: RequestInit = {
    method: request.method,
    headers: { Authorization: `Bot ${token}`, ...(request.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
  };
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${DISCORD_API_BASE}${request.path}`, init);
    if (response.status !== 429) return response;
    const retryAfter = Number(response.headers.get("Retry-After") ?? Number.NaN);
    if (attempt >= MAX_ATTEMPTS || !Number.isFinite(retryAfter) || retryAfter < 0 || retryAfter > MAX_RETRY_AFTER_SECONDS) throw new Error("discord_rate_limited");
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
  }
}
