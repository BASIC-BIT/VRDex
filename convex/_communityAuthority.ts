import type { Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";

export type AuthSubject = {
  tokenIdentifier: string;
  issuer: string;
  subject: string;
  displayName?: string;
};

type IdentityLike = {
  tokenIdentifier: string;
  issuer: string;
  subject: string;
  name?: string;
};

export type CommunityCapability =
  | "edit_community_profile"
  | "manage_profile"
  | "manage_roster"
  | "manage_events"
  | "manage_event_media"
  | "view_event_operations"
  | "manage_staff"
  | "manage_integrations"
  | "manage_billing";

const communityCapabilityAliases: Partial<Record<CommunityCapability, CommunityCapability[]>> = {
  edit_community_profile: ["manage_profile"],
  manage_profile: ["edit_community_profile"],
};

function hasCapability(capabilities: CommunityCapability[], requested: CommunityCapability): boolean {
  const accepted = [requested, ...(communityCapabilityAliases[requested] ?? [])];

  return accepted.some((capability) => capabilities.includes(capability));
}

export function toAuthSubject(identity: IdentityLike): AuthSubject {
  return {
    tokenIdentifier: identity.tokenIdentifier,
    issuer: identity.issuer,
    subject: identity.subject,
    ...(identity.name ? { displayName: identity.name.slice(0, 120) } : {}),
  };
}

export function isSameAuthSubject(first: AuthSubject | undefined, second: AuthSubject): boolean {
  return first?.tokenIdentifier === second.tokenIdentifier;
}

export async function subjectHasCommunityCapability(
  db: DatabaseReader,
  communityProfileId: Id<"profiles">,
  subject: AuthSubject,
  capability: CommunityCapability,
): Promise<boolean> {
  return subjectHasAnyCommunityCapability(db, communityProfileId, subject, [capability]);
}

export async function subjectHasAnyCommunityCapability(
  db: DatabaseReader,
  communityProfileId: Id<"profiles">,
  subject: AuthSubject,
  capabilities: CommunityCapability[],
): Promise<boolean> {
  const authorities = await db
    .query("communityAuthorities")
    .withIndex("by_subjectTokenIdentifier_state_communityProfileId", (query) =>
      query
        .eq("subjectTokenIdentifier", subject.tokenIdentifier)
        .eq("state", "active")
        .eq("communityProfileId", communityProfileId),
    )
    .take(20);

  return authorities.some((authority) =>
    capabilities.some((capability) => hasCapability(authority.capabilities as CommunityCapability[], capability)),
  );
}
