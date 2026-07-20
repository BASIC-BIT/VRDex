const DISCORD_HANDLE_PATTERN = /^[a-z0-9._]{2,32}(?:#[0-9]{4})?$/i;

type DiscordLink = {
  handle?: string;
  label: string;
  url: string;
};

function discordUrlTarget(url: string): { kind: "root" | "user"; userId?: string } | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const isDiscordHost =
      hostname === "discord.com" ||
      hostname.endsWith(".discord.com") ||
      hostname === "discordapp.com" ||
      hostname.endsWith(".discordapp.com");

    if (!isDiscordHost || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return null;
    }

    const userId = parsed.pathname.match(/^\/users\/([^/]+)\/?$/)?.[1];

    if (userId) {
      return { kind: "user", userId: decodeURIComponent(userId) };
    }

    return parsed.pathname === "/" || parsed.pathname === "" ? { kind: "root" } : null;
  } catch {
    return null;
  }
}

export function discordCopyValue(link: DiscordLink): string | null {
  const target = discordUrlTarget(link.url);

  if (!target) {
    return null;
  }

  const handle = link.handle?.trim();

  if (handle) {
    return handle;
  }

  const labeledHandle = link.label.match(/^Discord\s*:\s*(.+)$/i)?.[1]?.trim();

  if (labeledHandle && DISCORD_HANDLE_PATTERN.test(labeledHandle)) {
    return labeledHandle;
  }

  return target.kind === "user" ? target.userId ?? null : null;
}
