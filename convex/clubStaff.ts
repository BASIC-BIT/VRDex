import schema from "./schema";
import { clubVisibility, clubSubject } from "./_clubModel";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  activeBrowserSessionSubjectOrNull,
  requireActiveBrowserSessionSubject,
} from "./_browserSessionAuthority";
import {
  activeClubRoles,
  assignableRoleIdsFor,
  canReadCategory,
  readClubVisibility,
  requireClubPermission,
  resolveClubActor,
  resolveClubSubject,
  type ClubActor,
} from "./_clubAccess";
import {
  type ClubCategory,
  CLUB_CATEGORIES,
  CLUB_PERMISSIONS,
  clubAudience,
  clubCategory,
  clubPermission,
} from "./_clubModel";

function sameSubject(
  a: ClubActor["subject"],
  b: NonNullable<ClubActor["subject"]>,
) {
  return (
    a?.tokenIdentifier === b.tokenIdentifier &&
    a.subject === b.subject &&
    a.issuer === b.issuer
  );
}
const base = { communitySlug: v.string() };

export const listStaffWorkspaces = query({
  args: {},
  returns: v.object({
    workspaces: v.array(
      v.object({ slug: v.string(), displayName: v.string() }),
    ),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    const session = await activeBrowserSessionSubjectOrNull(ctx);
    if (!session) return { workspaces: [], hasMore: false };
    const rows = await ctx.db
      .query("communityAuthorities")
      .withIndex("by_subjectTokenIdentifier_state", (q) =>
        q
          .eq("subjectTokenIdentifier", session.subject.tokenIdentifier)
          .eq("state", "active"),
      )
      .take(101);
    const communityIds = [
      ...new Set(
        rows
          .slice(0, 100)
          .filter((row) => sameSubject(row.subject, session.subject))
          .map((row) => row.communityProfileId),
      ),
    ];
    const workspaces: Array<{ slug: string; displayName: string }> = [];
    for (const communityProfileId of communityIds) {
      const actor = await resolveClubActor(ctx, communityProfileId);
      // Owned communities already appear in the account's owned-profile list.
      if (actor.kind !== "staff") continue;
      const community = await ctx.db.get(communityProfileId);
      if (community?.profileType !== "community" || !community.slug) continue;
      workspaces.push({
        slug: community.slug,
        displayName: community.displayName,
      });
    }
    workspaces.sort(
      (a, b) =>
        a.displayName.localeCompare(b.displayName) ||
        a.slug.localeCompare(b.slug),
    );
    return { workspaces, hasMore: rows.length > 100 };
  },
});
const roleDoc = v.object({
  ...schema.tables.communityRoles.validator.fields,
  _id: v.id("communityRoles"),
  _creationTime: v.number(),
});
const assignmentDoc = v.object({
  ...schema.tables.communityAuthorities.validator.fields,
  _id: v.id("communityAuthorities"),
  _creationTime: v.number(),
});
const actionDoc = v.object({
  ...schema.tables.communityActionLog.validator.fields,
  _id: v.id("communityActionLog"),
  _creationTime: v.number(),
});
const integrationDoc = v.object({
  ...schema.tables.communityVrchatIntegrations.validator.fields,
  _id: v.id("communityVrchatIntegrations"),
  _creationTime: v.number(),
  collector: v.union(
    v.null(),
    v.object({
      vrchatUserId: v.string(),
      accountAlias: v.string(),
      state: v.string(),
    }),
  ),
});
const workspaceReturn = v.union(
  v.null(),
  v.object({
    community: v.object({
      _id: v.id("profiles"),
      slug: v.string(),
      displayName: v.string(),
    }),
    actor: v.object({
      kind: v.union(v.literal("owner"), v.literal("staff"), v.literal("none")),
      subject: v.optional(clubSubject),
      roleIds: v.array(v.id("communityRoles")),
      permissions: v.array(clubPermission),
    }),
    roles: v.array(roleDoc),
    assignments: v.array(assignmentDoc),
    hasMoreAssignments: v.boolean(),
    invitations: v.array(
      v.object({
        _id: v.id("communityStaffInvitations"),
        roleIds: v.array(v.id("communityRoles")),
        createdAt: v.number(),
        expiresAt: v.number(),
        state: v.union(
          v.literal("pending"),
          v.literal("accepted"),
          v.literal("revoked"),
          v.literal("expired"),
        ),
        createdBySubject: clubSubject,
      }),
    ),
    actionLog: v.array(actionDoc),
    visibility: v.union(v.null(), clubVisibility),
    integration: v.union(v.null(), integrationDoc),
    connectionState: v.union(v.null(), v.string()),
    readableCategories: v.array(clubCategory),
  }),
);
async function context(ctx: QueryCtx | MutationCtx, slug: string) {
  const community = await ctx.db
    .query("profiles")
    .withIndex("by_slug", (q) => q.eq("slug", slug.trim().toLowerCase()))
    .unique();
  if (!community || community.profileType !== "community")
    throw new Error("Club not found.");
  const actor = await resolveClubActor(ctx, community._id);
  return { community, actor };
}
function owner(actor: ClubActor) {
  if (actor.kind !== "owner")
    throw new Error("Only the club owner can change this setting.");
}
async function log(
  ctx: MutationCtx,
  communityProfileId: Id<"profiles">,
  actor: ClubActor,
  action: string,
  details: string | Record<string, string | string[] | null>,
) {
  if (!actor.subject) throw new Error("A signed-in user is required.");
  await ctx.db.insert("communityActionLog", {
    communityProfileId,
    actorSubject: actor.subject,
    action,
    details: typeof details === "string" ? { targetId: details } : details,
    createdAt: Date.now(),
  });
}
async function roleSet(
  ctx: QueryCtx | MutationCtx,
  communityProfileId: Id<"profiles">,
  ids: Id<"communityRoles">[],
) {
  if (ids.length > 100 || new Set(ids).size !== ids.length)
    throw new Error("Invalid role selection.");
  const roles = await activeClubRoles(ctx.db, communityProfileId);
  if (ids.some((id) => !roles.some((r) => r._id === id)))
    throw new Error("Invalid role selection.");
  return roles;
}
function canGrant(
  actor: ClubActor,
  roles: Doc<"communityRoles">[],
  ids: Id<"communityRoles">[],
) {
  const allowed = assignableRoleIdsFor(actor, roles);
  return (
    actor.kind === "owner" ||
    (actor.permissions.includes("manage_staff") &&
      ids.every((id) => allowed.includes(id)))
  );
}
async function hash(token: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
const invalid = () => new Error("This invitation is no longer valid.");
async function invitation(
  ctx: QueryCtx | MutationCtx,
  slug: string,
  token: string,
) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = await hash(token);
  const invite = await ctx.db
    .query("communityStaffInvitations")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!invite || invite.state !== "pending" || invite.expiresAt <= Date.now())
    return null;
  const community = await ctx.db.get(invite.communityProfileId);
  if (
    !community ||
    community.profileType !== "community" ||
    community.slug !== slug.trim().toLowerCase()
  )
    return null;
  const roles = await activeClubRoles(ctx.db, community._id);
  if (
    !invite.roleIds.length ||
    invite.roleIds.some((id) => !roles.some((r) => r._id === id))
  )
    return null;
  const inviter = await resolveClubSubject(
    ctx.db,
    community._id,
    invite.createdBySubject,
    (await activeBrowserSessionSubjectOrNull(ctx))?.subject.issuer ??
      process.env.CLERK_JWT_ISSUER_DOMAIN,
  );
  if (!canGrant(inviter, roles, invite.roleIds)) return null;
  return { invite, community, roles };
}

export const getWorkspace = query({
  args: base,
  returns: workspaceReturn,
  handler: async (ctx, args) => {
    const { community, actor } = await context(ctx, args.communitySlug);
    if (actor.kind === "none") return null;
    const roles = await activeClubRoles(ctx.db, community._id);
    const visibility = await readClubVisibility(ctx.db, community._id);
    const staffAccess =
      actor.kind === "owner" || actor.permissions.includes("manage_staff");
    const assignments = staffAccess
      ? await ctx.db
          .query("communityAuthorities")
          .withIndex("by_communityProfileId_state", (q) =>
            q.eq("communityProfileId", community._id).eq("state", "active"),
          )
          .take(501)
      : [];

    const invites = staffAccess
      ? await ctx.db
          .query("communityStaffInvitations")
          .withIndex("by_communityProfileId_state", (q) =>
            q.eq("communityProfileId", community._id).eq("state", "pending"),
          )
          .order("desc")
          .take(100)
      : [];
    const connection = await ctx.db
      .query("communityVrchatIntegrations")
      .withIndex("by_communityProfileId", (q) =>
        q.eq("communityProfileId", community._id),
      )
      .first();
    const collector = connection?.assignedCollectorAccountId
      ? await ctx.db.get(connection.assignedCollectorAccountId)
      : null;
    const integration =
      (actor.kind === "owner" ||
        actor.permissions.includes("manage_integrations")) &&
      connection
        ? {
            ...connection,
            collector: collector
              ? {
                  vrchatUserId: collector.vrchatUserId,
                  accountAlias: collector.accountAlias,
                  state: collector.state,
                }
              : null,
          }
        : null;
    return {
      community: {
        _id: community._id,
        slug: community.slug!,
        displayName: community.displayName,
      },
      actor,
      roles,
      assignments: assignments.slice(0, 500),
      hasMoreAssignments: assignments.length > 500,
      invitations: invites.map(
        ({ _id, roleIds, createdAt, expiresAt, state, createdBySubject }) => ({
          _id,
          roleIds,
          createdAt,
          expiresAt,
          state: expiresAt <= Date.now() ? ("expired" as const) : state,
          createdBySubject,
        }),
      ),
      actionLog:
        actor.kind === "owner"
          ? await ctx.db
              .query("communityActionLog")
              .withIndex("by_communityProfileId_createdAt", (q) =>
                q.eq("communityProfileId", community._id),
              )
              .order("desc")
              .take(50)
          : [],
      visibility: actor.kind === "owner" ? visibility : null,
      integration,
      connectionState: connection?.state ?? null,
      readableCategories: CLUB_CATEGORIES.filter((c) =>
        canReadCategory(actor, visibility, c),
      ),
    };
  },
});
export const seedPresetRoles = mutation({
  args: base,
  returns: v.null(),
  handler: async (ctx, args) => {
    const { community, actor } = await context(ctx, args.communitySlug);
    owner(actor);
    if ((await activeClubRoles(ctx.db, community._id)).length) return null;
    // Deleted presets must not reappear when the owner intentionally removes every role.
    const existing = await ctx.db
      .query("communityRoles")
      .withIndex("by_communityProfileId_state", (q) =>
        q.eq("communityProfileId", community._id).eq("state", "deleted"),
      )
      .first();
    if (existing) return null;
    for (const [presetKey, label, permissions] of [
      ["admin", "Admin", CLUB_PERMISSIONS],
      [
        "moderator",
        "Moderator",
        [
          "approve_join_requests",
          "view_members",
          "invite_group_members",
          "assign_vrchat_roles",
          "remove_group_members",
          "manage_bans",
        ],
      ],
      [
        "event_staff",
        "Event Staff",
        [
          "manage_events",
          "manage_event_media",
          "view_event_operations",
          "publish_posts",
          "manage_instances",
        ],
      ],
    ] as const) {
      await ctx.db.insert("communityRoles", {
        communityProfileId: community._id,
        key: presetKey,
        label,
        permissions: [...permissions],
        assignableRoleIds: [],
        presetKey,
        state: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    await log(
      ctx,
      community._id,
      actor,
      "roles_seeded",
      "Admin, Moderator, Event Staff",
    );
    return null;
  },
});
export const saveRole = mutation({
  args: {
    ...base,
    roleId: v.optional(v.id("communityRoles")),
    label: v.string(),
    description: v.optional(v.string()),
    permissions: v.array(clubPermission),
    assignableRoleIds: v.array(v.id("communityRoles")),
  },
  returns: v.id("communityRoles"),
  handler: async (ctx, args) => {
    const { community, actor } = await context(ctx, args.communitySlug);
    owner(actor);
    const label = args.label.trim();
    if (
      !label ||
      label.length > 80 ||
      (args.description?.length ?? 0) > 500 ||
      args.permissions.length > CLUB_PERMISSIONS.length
    )
      throw new Error("Invalid role details.");
    const roles = await roleSet(ctx, community._id, args.assignableRoleIds);
    if (
      args.roleId &&
      (!roles.some((r) => r._id === args.roleId) ||
        args.assignableRoleIds.includes(args.roleId))
    )
      throw new Error("Invalid role selection.");
    if (!args.roleId && roles.length >= 100)
      throw new Error("A club can have at most 100 roles.");
    const fields = {
      label,
      description: args.description?.trim(),
      permissions: [...new Set(args.permissions)],
      assignableRoleIds: args.assignableRoleIds,
      updatedAt: Date.now(),
    };
    let id = args.roleId;
    if (id) await ctx.db.patch(id, fields);
    else
      id = await ctx.db.insert("communityRoles", {
        ...fields,
        communityProfileId: community._id,
        key: crypto.randomUUID(),
        state: "active",
        createdAt: Date.now(),
      });
    await log(
      ctx,
      community._id,
      actor,
      args.roleId ? "role_updated" : "role_created",
      id,
    );
    return id;
  },
});
export const deleteRole = mutation({
  args: { ...base, roleId: v.id("communityRoles") },
  returns: v.array(clubCategory),
  handler: async (ctx, args) => {
    const { community, actor } = await context(ctx, args.communitySlug);
    owner(actor);
    const roles = await roleSet(ctx, community._id, [args.roleId]);
    const rows = await ctx.db
      .query("communityAuthorities")
      .withIndex("by_communityProfileId_state", (q) =>
        q.eq("communityProfileId", community._id).eq("state", "active"),
      )
      .take(501);
    if (rows.length > 500) throw new Error("Staff list requires pagination.");
    for (const row of rows)
      if (row.roleId === args.roleId)
        await ctx.db.patch(row._id, {
          state: "revoked",
          revokedAt: Date.now(),
          revokedBySubject: actor.subject,
          updatedAt: Date.now(),
        });
    for (const role of roles)
      if (role.assignableRoleIds.includes(args.roleId))
        await ctx.db.patch(role._id, {
          assignableRoleIds: role.assignableRoleIds.filter(
            (id) => id !== args.roleId,
          ),
          updatedAt: Date.now(),
        });
    const visibility = await readClubVisibility(ctx.db, community._id);
    const changed: ClubCategory[] = [];
    for (const category of CLUB_CATEGORIES) {
      const setting = visibility[category];
      if (setting.staffRoleIds?.includes(args.roleId)) {
        setting.staffRoleIds = setting.staffRoleIds.filter(
          (id) => id !== args.roleId,
        );
        if (!setting.staffRoleIds.length) {
          setting.audience = "owner";
          setting.staffRoleIds = null;
          changed.push(category);
        }
      }
    }
    const saved = await ctx.db
      .query("communityDataVisibility")
      .withIndex("by_communityProfileId", (q) =>
        q.eq("communityProfileId", community._id),
      )
      .unique();
    if (saved)
      await ctx.db.patch(saved._id, {
        categories: visibility,
        updatedAt: Date.now(),
      });
    await ctx.db.patch(args.roleId, {
      state: "deleted",
      updatedAt: Date.now(),
    });
    await log(ctx, community._id, actor, "role_deleted", {
      roleId: args.roleId,
      changedCategories: changed,
    });
    return changed;
  },
});
export const createStaffInvitation = mutation({
  args: { ...base, roleIds: v.array(v.id("communityRoles")) },
  returns: v.object({
    token: v.string(),
    invitationId: v.id("communityStaffInvitations"),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const { community, actor } = await context(ctx, args.communitySlug);
    const roles = await roleSet(ctx, community._id, args.roleIds);
    if (
      !args.roleIds.length ||
      !canGrant(actor, roles, args.roleIds) ||
      !actor.subject
    )
      throw new Error("You cannot invite these roles.");
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const expiresAt = Date.now() + 7 * 86400_000;
    const invitationId = await ctx.db.insert("communityStaffInvitations", {
      communityProfileId: community._id,
      tokenHash: await hash(token),
      roleIds: args.roleIds,
      createdBySubject: actor.subject,
      createdAt: Date.now(),
      expiresAt,
      state: "pending",
    });
    await log(ctx, community._id, actor, "invitation_created", invitationId);
    return { token, invitationId, expiresAt };
  },
});
export const revokeStaffInvitation = mutation({
  args: { ...base, invitationId: v.id("communityStaffInvitations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { community, actor } = await context(ctx, args.communitySlug);
    const row = await ctx.db.get(args.invitationId);
    if (!row || row.communityProfileId !== community._id) throw invalid();
    const roles = await activeClubRoles(ctx.db, community._id);
    if (
      actor.kind !== "owner" &&
      !sameSubject(actor.subject, row.createdBySubject) &&
      !canGrant(actor, roles, row.roleIds)
    )
      throw new Error("You cannot revoke this invitation.");
    if (row.state !== "pending") return null;
    await ctx.db.patch(row._id, {
      state: "revoked",
      revokedAt: Date.now(),
      revokedBySubject: actor.subject,
    });
    await log(ctx, community._id, actor, "invitation_revoked", row._id);
    return null;
  },
});
export const revokeAssignment = mutation({
  args: { ...base, assignmentId: v.id("communityAuthorities") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { community, actor } = await context(ctx, args.communitySlug);
    const row = await ctx.db.get(args.assignmentId);
    if (
      !row ||
      row.communityProfileId !== community._id ||
      row.subjectTokenIdentifier === actor.subject?.tokenIdentifier
    )
      throw new Error("You cannot revoke this assignment.");
    const roles = await activeClubRoles(ctx.db, community._id);
    if (
      actor.kind !== "owner" &&
      (!row.roleId || !canGrant(actor, roles, [row.roleId]))
    )
      throw new Error("You cannot revoke this assignment.");
    if (row.state === "revoked") return null;
    await ctx.db.patch(row._id, {
      state: "revoked",
      revokedAt: Date.now(),
      revokedBySubject: actor.subject,
      updatedAt: Date.now(),
    });
    await log(ctx, community._id, actor, "assignment_revoked", row._id);
    return null;
  },
});
export const setCategoryVisibility = mutation({
  args: {
    ...base,
    category: clubCategory,
    audience: clubAudience,
    staffRoleIds: v.union(v.null(), v.array(v.id("communityRoles"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { community, actor } = await context(ctx, args.communitySlug);
    owner(actor);
    if (
      args.category === "individual_membership_history" &&
      args.audience === "public"
    )
      throw new Error("Individual membership history cannot be public.");
    if (args.staffRoleIds !== null) {
      if (!args.staffRoleIds.length)
        throw new Error("Choose at least one role.");
      await roleSet(ctx, community._id, args.staffRoleIds);
    }
    const categories = await readClubVisibility(ctx.db, community._id);
    categories[args.category] = {
      audience: args.audience,
      staffRoleIds: args.audience === "staff" ? args.staffRoleIds : null,
    };
    const saved = await ctx.db
      .query("communityDataVisibility")
      .withIndex("by_communityProfileId", (q) =>
        q.eq("communityProfileId", community._id),
      )
      .unique();
    if (saved)
      await ctx.db.patch(saved._id, { categories, updatedAt: Date.now() });
    else
      await ctx.db.insert("communityDataVisibility", {
        communityProfileId: community._id,
        categories,
        updatedAt: Date.now(),
      });
    await log(ctx, community._id, actor, "visibility_changed", {
      category: args.category,
      audience: categories[args.category].audience,
      staffRoleIds: categories[args.category].staffRoleIds,
    });
    return null;
  },
});
export const getInvitation = query({
  args: { ...base, token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      community: v.object({ displayName: v.string(), slug: v.string() }),
      roles: v.array(
        v.object({ _id: v.id("communityRoles"), label: v.string() }),
      ),
      expiresAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const found = await invitation(ctx, args.communitySlug, args.token);
    if (!found) return null;
    return {
      community: {
        displayName: found.community.displayName,
        slug: found.community.slug!,
      },
      roles: found.roles
        .filter((r) => found.invite.roleIds.includes(r._id))
        .map((r) => ({ _id: r._id, label: r.label })),
      expiresAt: found.invite.expiresAt,
    };
  },
});
export const acceptStaffInvitation = mutation({
  args: { ...base, token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireActiveBrowserSessionSubject(ctx);
    const found = await invitation(ctx, args.communitySlug, args.token);
    if (!found) throw invalid();
    const { invite, community } = found;
    const actor = await resolveClubActor(ctx, community._id);
    if (
      actor.kind === "owner" ||
      session.subject.tokenIdentifier ===
        invite.createdBySubject.tokenIdentifier ||
      invite.roleIds.some((id) => actor.roleIds.includes(id))
    )
      throw invalid();
    const clubAssignments = await ctx.db
      .query("communityAuthorities")
      .withIndex("by_communityProfileId_state", (q) =>
        q.eq("communityProfileId", community._id).eq("state", "active"),
      )
      .take(501);
    if (clubAssignments.length + invite.roleIds.length > 500)
      throw new Error(
        "Club assignment limit exceeded. Ask the owner to remove unused assignments.",
      );
    const existingAssignments = await ctx.db
      .query("communityAuthorities")
      .withIndex("by_subjectTokenIdentifier_state_communityProfileId", (q) =>
        q
          .eq("subjectTokenIdentifier", session.subject.tokenIdentifier)
          .eq("state", "active")
          .eq("communityProfileId", community._id),
      )
      .take(101);
    if (existingAssignments.length + invite.roleIds.length > 100)
      throw new Error("Club assignment limit exceeded.");
    for (const roleId of invite.roleIds) {
      const id = await ctx.db.insert("communityAuthorities", {
        communityProfileId: community._id,
        subjectTokenIdentifier: session.subject.tokenIdentifier,
        subject: session.subject,
        roleId,
        state: "active",
        grantedAt: Date.now(),
        grantedBySubject: invite.createdBySubject,
        updatedAt: Date.now(),
      });
      await log(
        ctx,
        community._id,
        { ...actor, subject: session.subject },
        "assignment_granted",
        id,
      );
    }
    await ctx.db.patch(invite._id, {
      state: "accepted",
      acceptedBySubject: session.subject,
      acceptedAt: Date.now(),
    });
    await log(
      ctx,
      community._id,
      { ...actor, subject: session.subject },
      "invitation_accepted",
      invite._id,
    );
    return null;
  },
});
