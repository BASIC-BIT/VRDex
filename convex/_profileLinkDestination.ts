export type ProfileLinkDestination = {
  kind: "vrchat_user" | "vrchat_group" | "discord_guild";
  locator: string;
  key: string;
};

/** Recognize provider-owned locators without fetching or following arbitrary URLs. */
export function parseProfileLinkDestination(input: { url: string; type?: string } | string): ProfileLinkDestination | null {
  try {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/$/, "");
    let kind: ProfileLinkDestination["kind"];
    let locator: string;
    const uuid = "[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}";
    const vrchat = host === "vrchat.com" ? path.match(new RegExp(`^/home/(user|group)/((?:usr|grp)_${uuid})$`)) : null;
    if (vrchat && ((vrchat[1] === "user" && vrchat[2].startsWith("usr_")) || (vrchat[1] === "group" && vrchat[2].startsWith("grp_")))) {
      kind = vrchat[1] === "user" ? "vrchat_user" : "vrchat_group";
      locator = vrchat[2].toLowerCase();
    } else if (host === "vrc.group" && /^\/[A-Za-z0-9]{3,6}\.\d{4}$/.test(path)) {
      kind = "vrchat_group";
      locator = path.slice(1).toUpperCase();
    } else if (host === "vrch.at" && new RegExp(`^/usr_${uuid}$`).test(path)) {
      kind = "vrchat_user";
      locator = path.slice(1).toLowerCase();
    } else {
      const invite = host === "discord.gg" ? path.match(/^\/([A-Za-z0-9_-]{1,100})$/)
        : ["discord.com", "discordapp.com"].includes(host) ? path.match(/^\/invite\/([A-Za-z0-9_-]{1,100})$/) : null;
      if (!invite) return null;
      kind = "discord_guild";
      locator = invite[1];
    }
    return { kind, locator, key: `${kind}:${locator}` };
  } catch {
    return null;
  }
}
