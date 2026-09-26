import type { Doc, Id } from "./_generated/dataModel";
import type {
  DatabaseReader,
  QueryCtx,
  MutationCtx,
} from "./_generated/server";
import { activeBrowserSessionSubjectOrNull } from "./_browserSessionAuthority";
import type { AuthSubject } from "./_communityAuthority";
import { userOwnsProfile, getActiveProfileOwner } from "./_profileOwnership";
import {
  CLUB_PERMISSIONS,
  LEGACY_CATEGORY_MAP,
  defaultClubVisibility,
  type ClubPermission,
  type ClubCategory,
  type ClubVisibility,
} from "./_clubModel";

export type ClubActor = {
  kind: "owner" | "staff" | "none";
  subject?: AuthSubject;
  roleIds: Id<"communityRoles">[];
  permissions: ClubPermission[];
};
export async function activeClubRoles(
  db: DatabaseReader,
  communityProfileId: Id<"profiles">,
) {
  const roles = await db
    .query("communityRoles")
    .withIndex("by_communityProfileId_state", (q) =>
      q.eq("communityProfileId", communityProfileId).eq("state", "active"),
    )
    .take(101);
  if (roles.length > 100) throw new Error("Club role limit exceeded.");
  return roles;
}
export async function resolveClubSubject(
  db: DatabaseReader,
  communityProfileId: Id<"profiles">,
  subject: AuthSubject,
  trustedIssuer = process.env.CLERK_JWT_ISSUER_DOMAIN,
): Promise<ClubActor> {
  const owner = await getActiveProfileOwner(db, communityProfileId);
  const ownerUser = owner ? await db.get(owner.userId) : null;
  if (
    ownerUser?.clerkUserId === subject.subject &&
    subject.tokenIdentifier === `${subject.issuer}|${subject.subject}` &&
    subject.issuer === trustedIssuer
  )
    return {
      kind: "owner",
      subject,
      roleIds: [],
      permissions: CLUB_PERMISSIONS,
    };
  const rows = await db
    .query("communityAuthorities")
    .withIndex("by_subjectTokenIdentifier_state_communityProfileId", (q) =>
      q
        .eq("subjectTokenIdentifier", subject.tokenIdentifier)
        .eq("state", "active")
        .eq("communityProfileId", communityProfileId),
    )
    .take(101);
  if (rows.length > 100) throw new Error("Club assignment limit exceeded.");
  const roles = await activeClubRoles(db, communityProfileId);
  const canonicalRows = rows.filter(
    (row) =>
      row.subject.subject === subject.subject &&
      row.subject.issuer === subject.issuer,
  );
  const held = roles.filter((role) =>
    canonicalRows.some((row) => row.roleId === role._id),
  );
  // Preserve legacy grants until a separately verified data migration removes them.
  const legacy = canonicalRows
    .filter((row) => !row.roleId)
    .flatMap((row) => row.capabilities ?? [])
    .map((p) => (p === "manage_profile" ? "edit_community_profile" : p))
    .filter((p) =>
      CLUB_PERMISSIONS.includes(p as ClubPermission),
    ) as ClubPermission[];
  return {
    kind: held.length || legacy.length ? "staff" : "none",
    subject,
    roleIds: held.map((r) => r._id),
    permissions: [
      ...new Set([...held.flatMap((r) => r.permissions), ...legacy]),
    ],
  };
}
export async function resolveClubActor(
  ctx: QueryCtx | MutationCtx,
  communityProfileId: Id<"profiles">,
): Promise<ClubActor> {
  const session = await activeBrowserSessionSubjectOrNull(ctx);
  if (!session) return { kind: "none", roleIds: [], permissions: [] };
  if (await userOwnsProfile(ctx.db, communityProfileId, session.userId))
    return {
      kind: "owner",
      subject: session.subject,
      roleIds: [],
      permissions: CLUB_PERMISSIONS,
    };
  return resolveClubSubject(ctx.db, communityProfileId, session.subject);
}
export function requireClubPermission(
  actor: ClubActor,
  permission: ClubPermission,
) {
  if (actor.kind !== "owner" && !actor.permissions.includes(permission))
    throw new Error("You do not have access to this action.");
}
export function canReadCategory(
  actor: ClubActor,
  visibility: ClubVisibility,
  category: ClubCategory,
) {
  const setting = visibility[category];
  return (
    actor.kind === "owner" ||
    setting.audience === "public" ||
    (setting.audience === "staff" &&
      actor.kind === "staff" &&
      (setting.staffRoleIds === null ||
        setting.staffRoleIds.some((id) => actor.roleIds.includes(id))))
  );
}
export function assignableRoleIdsFor(
  actor: ClubActor,
  roles: Doc<"communityRoles">[],
) {
  return actor.kind === "owner"
    ? roles.map((r) => r._id)
    : [
        ...new Set(
          roles
            .filter((r) => actor.roleIds.includes(r._id))
            .flatMap((r) => r.assignableRoleIds),
        ),
      ];
}
export async function readClubVisibility(
  db: DatabaseReader,
  communityProfileId: Id<"profiles">,
): Promise<ClubVisibility> {
  const saved = await db
    .query("communityDataVisibility")
    .withIndex("by_communityProfileId", (q) =>
      q.eq("communityProfileId", communityProfileId),
    )
    .unique();
  if (saved) return saved.categories;
  const defaults = defaultClubVisibility();
  const integration = await db
    .query("communityVrchatIntegrations")
    .withIndex("by_communityProfileId", (q) =>
      q.eq("communityProfileId", communityProfileId),
    )
    .first();
  for (const [key, category] of Object.entries(LEGACY_CATEGORY_MAP))
    if (integration?.publicMetrics[key as keyof typeof LEGACY_CATEGORY_MAP])
      defaults[category] = { audience: "public", staffRoleIds: null };
  return defaults;
}
