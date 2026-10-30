import type { ConnectorSummary } from "./connectorCache";

export type MessagePayload = {
  messageId: string;
  authorId: string;
  authorDisplayName: string;
  isBot: boolean;
  content: string;
  createdAt: number;
  editedAt?: number;
  attachments: Array<{ url: string; contentType: string; byteLength: number }>;
};

export type RelayableMessage = {
  id: string;
  system: boolean;
  content: string;
  createdTimestamp: number;
  editedTimestamp: number | null;
  author: { id: string; bot: boolean; username: string; globalName?: string | null };
  member?: { displayName: string } | null;
  attachments: Map<string, { url: string; contentType: string | null; size: number }>;
};

/** The relay shape of a human post with text or an image, or `null` for everything intake ignores. */
export function toMessagePayload(message: RelayableMessage): MessagePayload | null {
  if (message.author.bot || message.system) return null;
  const attachments = [...message.attachments.values()].flatMap(({ url, contentType, size }) =>
    contentType?.startsWith("image/") ? [{ url, contentType, byteLength: size }] : []);
  if (message.content.trim() === "" && attachments.length === 0) return null;
  return {
    messageId: message.id,
    authorId: message.author.id,
    authorDisplayName: message.member?.displayName ?? message.author.globalName ?? message.author.username,
    isBot: false,
    content: message.content,
    createdAt: message.createdTimestamp,
    ...(message.editedTimestamp === null ? {} : { editedAt: message.editedTimestamp }),
    attachments,
  };
}

const intakeUrl = (path: string) => `${process.env.CONVEX_SITE_URL}${path}`;
const intakeAuthorization = () => `Bearer ${process.env.DISCORD_INTAKE_SECRET}`;

export function postIntake(path: string, body: unknown): Promise<Response> {
  return fetch(intakeUrl(path), {
    method: "POST",
    headers: { authorization: intakeAuthorization(), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function relay(
  kind: "message" | "scheduled_event",
  action: "create" | "update" | "delete",
  guildId: string,
  channelId: string | undefined,
  payload: unknown,
): Promise<void> {
  const response = await postIntake("/discord-intake/relay", { kind, action, guildId, channelId, payload });
  if (!response.ok) throw new Error(`Discord intake relay answered ${response.status}.`);
}

export async function fetchConnectors(query?: { guildId: string; channelId?: string }): Promise<ConnectorSummary[]> {
  const url = new URL(intakeUrl("/discord-intake/connectors"));
  if (query) url.searchParams.set("guildId", query.guildId);
  if (query?.channelId) url.searchParams.set("channelId", query.channelId);
  const response = await fetch(url, { headers: { authorization: intakeAuthorization() } });
  if (!response.ok) throw new Error(`Discord intake connectors answered ${response.status}.`);
  return ((await response.json()) as { connectors: ConnectorSummary[] }).connectors;
}

/** Relays one gateway message event when its channel is connected. Failures log one line and never reach the event handler. */
export async function relayConnected(
  getConnectors: (query: { guildId: string; channelId: string }) => Promise<ConnectorSummary[]>,
  action: "create" | "update" | "delete",
  { id, guildId, channelId }: { id: string; guildId: string | null; channelId: string },
  buildPayload: () => unknown,
): Promise<void> {
  if (guildId === null) return;
  try {
    const connectors = await getConnectors({ guildId, channelId });
    if (!connectors.some(row => row.kind === "discord_announcements" && row.state === "active")) return;
    const payload = await buildPayload();
    if (payload !== null) await relay("message", action, guildId, channelId, payload);
  } catch {
    console.error(JSON.stringify({ event: "discord_gateway_relay_failed", messageId: id }));
  }
}
