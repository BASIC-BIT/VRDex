const reservedTwitchPaths = new Set([
  "directory",
  "downloads",
  "jobs",
  "p",
  "settings",
  "subscriptions",
  "turbo",
  "videos",
]);

export function twitchLoginFromUrl(input: string): string | null {
  try {
    const url = new URL(input);
    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    const [login, extra] = url.pathname.split("/").filter(Boolean);

    if (
      url.protocol !== "https:" ||
      hostname !== "twitch.tv" ||
      Boolean(url.username || url.password || url.search || url.hash) ||
      !login ||
      extra ||
      reservedTwitchPaths.has(login.toLowerCase()) ||
      !/^[a-zA-Z0-9_]{3,25}$/.test(login)
    ) {
      return null;
    }

    return login.toLowerCase();
  } catch {
    return null;
  }
}
