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

type CommunityCapability =
  | "manage_profile"
  | "manage_events"
  | "manage_staff"
  | "manage_integrations"
  | "manage_billing";

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
  const authorities = await db
    .query("communityAuthorities")
    .withIndex("by_subjectTokenIdentifier_state_communityProfileId", (query) =>
      query
        .eq("subjectTokenIdentifier", subject.tokenIdentifier)
        .eq("state", "active")
        .eq("communityProfileId", communityProfileId),
    )
    .take(1);

  return authorities.some((authority) => authority.capabilities.includes(capability));
}
