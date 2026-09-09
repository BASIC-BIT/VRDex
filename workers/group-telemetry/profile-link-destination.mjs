const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const GROUP_ID = new RegExp(`^grp_${UUID}$`, "i");
const USER_ID = new RegExp(`^usr_${UUID}$`, "i");
const GROUP_CODE = /^[a-z0-9]{3,6}\.\d{4}$/i;
const GROUP_REDIRECT = new RegExp(`^(?:https://vrchat\\.com)?/home/group/(grp_${UUID})/?$`, "i");
const INVITE_CODE = /^[a-z0-9_-]{1,100}$/i;
const USER_AGENT = "VRDex/1.0 (https://vrdex.net)";

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function name(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 256
    && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim() : null;
}

function retryAfterMs(response) {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export function allowedDestinationArtworkUrl(value, kind) {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return undefined;
    // Provider-returned media only. Recheck this policy on every redirect;
    // the importer separately pins public IPs and bounds and re-encodes image data.
    const hosts = kind === "discord_guild" ? ["cdn.discordapp.com"]
      : kind === "vrchat_user" || kind === "vrchat_group"
        ? ["api.vrchat.cloud", "api.vrchat.com", "files.vrchat.cloud"] : [];
    return hosts.includes(url.hostname) ? url.href : undefined;
  } catch { return undefined; }
}

function providerFailure(error) {
  // Account-wide failures must reach the collector's existing session/cooldown handling.
  if (error?.status === 401 || error?.status === 429 || ["authentication", "rate_limit", "metadata_budget", "control_plane"].includes(error?.category)) throw error;
  if (error?.status === 404 || error?.status === 410) return { status: "invalid" };
  if (error?.status === 403) return { status: "inaccessible" };
  return { status: "transient", ...(Number.isFinite(error?.retryAfterMs) ? { retryAfterMs: Math.max(0, error.retryAfterMs) } : {}) };
}

async function boundedResponse(url, fetcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(url, { redirect: "manual", signal: controller.signal, headers: { accept: "application/json", "user-agent": USER_AGENT } });
    if (!response.ok) {
      await response.body?.cancel();
      return { response, body: null };
    }
    if (!response.body) throw new Error("Missing provider body");
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 256 * 1024) throw new Error("Provider body too large");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    return { response, body: JSON.parse(new TextDecoder().decode(body)) };
  } finally { clearTimeout(timer); }
}

export async function resolveProfileLinkDestination(target, { requestVrchat, fetcher = fetch } = {}) {
  if (!target || typeof target.locator !== "string") return { status: "invalid" };
  if (target.kind === "discord_guild") {
    if (!INVITE_CODE.test(target.locator)) return { status: "invalid" };
    try {
      const { response, body } = await boundedResponse(`https://discord.com/api/v10/invites/${encodeURIComponent(target.locator)}`, fetcher);
      if (response.status === 404 || response.status === 410) return { status: "invalid" };
      if (!response.ok) {
        const retry = retryAfterMs(response);
        return { status: "transient", ...(retry !== undefined ? { retryAfterMs: retry } : {}) };
      }
      const invite = record(body);
      const guild = record(invite.guild);
      if (invite.type !== 0) return { status: "inaccessible" };
      if (invite.code !== target.locator || typeof guild.id !== "string" || !/^\d{5,25}$/.test(guild.id) || !name(guild.name)) return { status: "transient" };
      if (typeof invite.expires_at === "string" && Number.isFinite(Date.parse(invite.expires_at)) && Date.parse(invite.expires_at) <= Date.now()) return { status: "invalid" };
      const artworkSourceUrl = typeof guild.icon === "string" && guild.icon.trim()
        ? allowedDestinationArtworkUrl(`https://cdn.discordapp.com/icons/${guild.id}/${encodeURIComponent(guild.icon)}.png?size=512`, target.kind)
        : undefined;
      return { status: "resolved", entityId: guild.id, displayName: name(guild.name), ...(artworkSourceUrl ? { artworkSourceUrl, artworkType: "server_icon" } : {}) };
    } catch { return { status: "transient" }; }
  }
  if (!["vrchat_user", "vrchat_group"].includes(target.kind)) return { status: "invalid" };
  if (!requestVrchat) return { status: "transient" };
  try {
    let id = target.locator;
    if (target.kind === "vrchat_group" && GROUP_CODE.test(id)) {
      // The fixed redirect endpoint resolves the exact code, never a fuzzy group search.
      const { response } = await boundedResponse(`https://api.vrchat.cloud/api/1/groups/redirect/${encodeURIComponent(id)}`, fetcher);
      if (response.status === 429) {
        const error = new Error("Group redirect rate limited");
        error.status = 429;
        error.category = "rate_limit";
        error.retryAfterMs = retryAfterMs(response) ?? 60_000;
        throw error;
      }
      if (response.status === 404 || response.status === 410) return { status: "invalid" };
      if (![301, 302, 303, 307, 308].includes(response.status)) return { status: "transient" };
      // The canonical API returns a root-relative group path. Also accept its
      // public absolute form, extracting the ID without following the redirect.
      const match = (response.headers.get("location") ?? "").match(GROUP_REDIRECT);
      if (!match) return { status: "transient" };
      id = match[1];
    }
    const isGroup = target.kind === "vrchat_group";
    if (!(isGroup ? GROUP_ID : USER_ID).test(id)) return { status: "invalid" };
    const entity = record(await requestVrchat(`/${isGroup ? "groups" : "users"}/${encodeURIComponent(id)}`));
    if (typeof entity.id !== "string" || entity.id.toLowerCase() !== id.toLowerCase()) return { status: "transient" };
    if (isGroup && entity.privacy !== "default") return { status: "inaccessible" };
    const displayName = name(isGroup ? entity.name : entity.displayName);
    if (!displayName) return { status: "transient" };
    const candidates = isGroup ? [entity.iconUrl] : [entity.userIcon];
    const artworkSourceUrl = candidates.map((url) => allowedDestinationArtworkUrl(url, target.kind)).find(Boolean);
    return { status: "resolved", entityId: entity.id.toLowerCase(), displayName, ...(artworkSourceUrl ? { artworkSourceUrl, artworkType: isGroup ? "group_icon" : "user_icon" } : {}) };
  } catch (error) { return providerFailure(error); }
}
