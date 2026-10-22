import { sanitizeEventMediaPublicLinks, type EventMediaPublicLinkInput } from "./_eventMediaControl";

type VrcdnOutputAccount = {
  key: string;
  label: string;
  credentialRef: string;
  ownerCommunityProfileId: string;
  authorizedCommunityProfileIds: string[];
  playbackLinks: EventMediaPublicLinkInput[];
};
export type PublicVrcdnOutputAccount = Pick<VrcdnOutputAccount, "key" | "label" | "playbackLinks">;

// Deployment-owned entitlement bindings, like Twitch. There is deliberately no
// global fallback account: a secret reference alone never grants publication.
function registry(): VrcdnOutputAccount[] {
  const entries: unknown = JSON.parse(process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON ?? "[]");
  if (!Array.isArray(entries) || entries.length > 32) throw Error("Invalid VRCDN account configuration.");
  const accounts: VrcdnOutputAccount[] = [];
  for (const entry of entries as unknown[]) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const { key, label, credentialRef, ownerCommunityProfileId, playbackLinks = [], authorizedCommunityProfileIds = [] } = record;
    if (
      typeof key !== "string" || !key.trim() || key.length > 64 ||
      typeof label !== "string" || !label.trim() || label.length > 80 ||
      typeof credentialRef !== "string" || !credentialRef.trim() || credentialRef.length > 256 ||
      typeof ownerCommunityProfileId !== "string" || !ownerCommunityProfileId.trim() || ownerCommunityProfileId.length > 64 ||
      !Array.isArray(authorizedCommunityProfileIds) || authorizedCommunityProfileIds.length > 32 ||
      !authorizedCommunityProfileIds.every((id: unknown) => typeof id === "string" && id.length > 0 && id.length <= 64) ||
      !Array.isArray(playbackLinks) || playbackLinks.length > 8 ||
      !playbackLinks.every((link: unknown) => link !== null && typeof link === "object" && "platform" in link && "url" in link && typeof link.url === "string" && ["browser", "pc", "standalone"].includes(String(link.platform)) && (!("label" in link) || typeof link.label === "string")) ||
      Object.keys(record).some(k => !["key", "label", "credentialRef", "ownerCommunityProfileId", "authorizedCommunityProfileIds", "playbackLinks"].includes(k))
    ) continue;
    if (accounts.some(a => a.key === key || a.credentialRef === credentialRef)) throw Error("Duplicate VRCDN account configuration.");
    accounts.push({ key, label, credentialRef, ownerCommunityProfileId, authorizedCommunityProfileIds, playbackLinks: sanitizeEventMediaPublicLinks(playbackLinks as EventMediaPublicLinkInput[]) });
  }
  return accounts;
}
function authorized(account: VrcdnOutputAccount, communityProfileId?: string) {
  return communityProfileId !== undefined && (account.ownerCommunityProfileId === communityProfileId || account.authorizedCommunityProfileIds.includes(communityProfileId));
}
export function getVrcdnOutputAccount(input: { communityProfileId?: string; key?: string; credentialRef?: string }): VrcdnOutputAccount {
  const account = registry().find(account => authorized(account, input.communityProfileId) && (input.key !== undefined ? account.key === input.key : input.credentialRef !== undefined && account.credentialRef === input.credentialRef));
  if (!account || (input.credentialRef !== undefined && account.credentialRef !== input.credentialRef)) throw Error("Output account is not authorized for this community.");
  return account;
}
export function listPublicVrcdnOutputAccounts(communityProfileId?: string): PublicVrcdnOutputAccount[] {
  try {
    return registry().filter(account => authorized(account, communityProfileId)).map(({ key, label, playbackLinks }) => ({ key, label, playbackLinks }));
  } catch { return []; }
}
