import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  sanitizeVrcdnOperatorOwnedOutputSetup,
  type VrcdnOperatorOwnedOutputSetupInput,
} from "./_eventMediaControl";
export const twitchSetupValidator = v.object({
  channel: v.string(),
  profile: v.literal("twitch-conservative-720p30"),
  accountKey: v.optional(v.string()),
});
export const outputHealthValidator = v.object({
  outputId: v.id("eventMediaOutputs"),
  destination: v.union(v.literal("vrcdn"), v.literal("twitch")),
  status: v.union(
    ...(
      [
        "idle",
        "connecting",
        "publishing",
        "reconnecting",
        "invalid_setup",
        "stopped",
      ] as const
    ).map((s) => v.literal(s)),
  ),
  publishing: v.boolean(),
  queueBytes: v.number(),
  outputMs: v.number(),
  restarts: v.number(),
});
export function sanitizeTwitchOutput(
  input: VrcdnOperatorOwnedOutputSetupInput & {
    channel: string;
    simulcastEnabled?: boolean;
  },
) {
  const base = sanitizeVrcdnOperatorOwnedOutputSetup(input);
  const channel = input.channel.trim().toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(channel))
    throw Error("Invalid Twitch channel.");
  const { vrcdnSetup: _, ...common } = base;
  return {
    ...common,
    type: "external_rtmp" as const,
    twitchSetup: { channel, profile: "twitch-conservative-720p30" as const },
    simulcastEnabled: input.simulcastEnabled === true,
    playbackLinks: [
      {
        platform: "browser" as const,
        label: "Twitch",
        url: `https://www.twitch.tv/${channel}`,
      },
    ],
  };
}
// Deployment-owned bindings. An unbound account grants no publication authority.
type TwitchAccount = {
  key: string;
  channel: string;
  credentialRef: string;
  ownerCommunityProfileId: string;
  authorizedCommunityProfileIds: string[];
};
function registry(): TwitchAccount[] {
  const entries: unknown = JSON.parse(
    process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON ?? "[]",
  );
  if (!Array.isArray(entries) || entries.length > 32)
    throw Error("Invalid Twitch account configuration.");
  const accounts: TwitchAccount[] = [];
  for (const entry of entries as unknown[]) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("key" in entry) ||
      !("channel" in entry) ||
      !("credentialRef" in entry) ||
      !("ownerCommunityProfileId" in entry)
    )
      continue;
    const { key, channel, credentialRef, ownerCommunityProfileId } = entry;
    const grants =
      "authorizedCommunityProfileIds" in entry
        ? entry.authorizedCommunityProfileIds
        : [];
    if (
      typeof key !== "string" ||
      !key.trim() ||
      key.length > 64 ||
      typeof channel !== "string" ||
      !/^[a-z0-9_]{1,25}$/.test(channel) ||
      typeof credentialRef !== "string" ||
      !credentialRef.trim() ||
      credentialRef.length > 256 ||
      typeof ownerCommunityProfileId !== "string" ||
      !ownerCommunityProfileId.trim() ||
      ownerCommunityProfileId.length > 64 ||
      !Array.isArray(grants) ||
      grants.length > 32 ||
      !grants.every(
        (id: unknown) =>
          typeof id === "string" && id.length > 0 && id.length <= 64,
      ) ||
      Object.keys(entry).some(
        (k) =>
          ![
            "key",
            "channel",
            "credentialRef",
            "ownerCommunityProfileId",
            "authorizedCommunityProfileIds",
          ].includes(k),
      )
    )
      continue;
    if (
      accounts.some(
        (account) =>
          account.key === key || account.credentialRef === credentialRef,
      )
    )
      throw Error("Duplicate Twitch account configuration.");
    accounts.push({
      key,
      channel,
      credentialRef,
      ownerCommunityProfileId,
      authorizedCommunityProfileIds: grants,
    });
  }
  return accounts;
}
function authorized(account: TwitchAccount, communityProfileId?: string) {
  return (
    communityProfileId !== undefined &&
    (account.ownerCommunityProfileId === communityProfileId ||
      account.authorizedCommunityProfileIds.includes(communityProfileId))
  );
}
export function getTwitchOutputAccount(input: {
  communityProfileId?: string;
  key?: string;
  credentialRef?: string;
  channel?: string;
}) {
  const account = registry().find(
    (account) =>
      authorized(account, input.communityProfileId) &&
      (input.key !== undefined
        ? account.key === input.key
        : account.credentialRef === input.credentialRef &&
          account.channel === input.channel?.trim().toLowerCase()),
  );
  if (
    !account ||
    (input.credentialRef !== undefined &&
      account.credentialRef !== input.credentialRef)
  )
    throw Error("Output account is not authorized for this community.");
  return account;
}
export function listTwitchOutputAccounts(
  communityProfileId?: string,
): { key: string; channel: string }[] {
  try {
    return registry()
      .filter((account) => authorized(account, communityProfileId))
      .map(({ key, channel }) => ({ key, channel }));
  } catch {
    return [];
  }
}
/** Shared by setup, dispatch and live worker authority. Never trust persisted ready state alone. */
export function eventOutputIsAuthorized(
  event: Pick<Doc<"events">, "communityProfileId">,
  output: Doc<"eventMediaOutputs">,
) {
  if (!output.twitchSetup) return true;
  if (output.type !== "external_rtmp" || !output.credential) return false;
  try {
    const account = getTwitchOutputAccount({
      communityProfileId: event.communityProfileId,
      key: output.twitchSetup.accountKey,
      credentialRef: output.credential.secretRef,
      channel: output.twitchSetup.channel,
    });
    return account.channel === output.twitchSetup.channel;
  } catch {
    return false;
  }
}
