// No credentials or raw provider records leave this boundary.
const requirements = {
  invitation_eligibility: ["instances"],
  instances: ["instances"],
  instance_roles: ["instances", "group-instance-restricted-create"],
  members: [
    "membership_management",
    "group-members-viewall",
    "group-members-manage",
  ],
  search: [
    "membership_management",
    "group-members-viewall",
    "group-members-manage",
  ],
  member: [
    "membership_management",
    "group-members-viewall",
    "group-members-manage",
  ],
  requests: ["membership_management", "group-invites-manage"],
  invites: ["membership_management", "group-invites-manage"],
  roles: [
    "membership_management",
    "group-roles-assign",
    "group-members-manage",
  ],
  bans: ["membership_management", "group-bans-manage", "group-members-manage"],
  posts: ["posts", "group-announcement-manage"],
};
const userId =
  /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function string(value, max = 200) {
  if (typeof value !== "string" || value.length > max)
    throw new Error("schema_drift");
  return value;
}
function optional(target, field, value, max) {
  if (value !== undefined && value !== null) target[field] = string(value, max);
}
function project(kind, row) {
  if (!row || typeof row !== "object" || Array.isArray(row))
    throw new Error("schema_drift");
  if (kind === "invitation_eligibility") {
    if (!userId.test(row.userId ?? "") || !["friend", "not_friend"].includes(row.friendship) || !["open", "closed", "pending"].includes(row.destinationState)) throw new Error("schema_drift");
    return { id: row.userId, userId: row.userId, friendship: row.friendship, destinationState: row.destinationState,
      invitationEligibility: row.friendship === "not_friend" ? "not_friend" : row.destinationState === "pending" ? "destination_pending" : row.destinationState === "closed" ? "destination_closed" : "eligible" };
  }
  if (kind === "instances") {
    return {
      id: string(row.location, 600),
      worldId: string(row.world.id, 100),
      instanceId: string(row.instanceId, 500),
      name: string(row.world.name, 200),
    };
  }
  if (kind === "roles" || kind === "instance_roles") {
    const item = { id: string(row.id, 100) };
    optional(item, "name", row.name, 200);
    return item;
  }
  if (kind === "posts") {
    const item = { id: string(row.id, 100) };
    for (const field of [
      "title",
      "text",
      "createdAt",
      "updatedAt",
      "visibility",
      "imageId",
    ])
      optional(
        item,
        field,
        row[field],
        field === "text" ? 20_000 : field === "title" ? 1000 : 100,
      );
    return item;
  }
  const id = row.userId ?? row.user?.id;
  if (!userId.test(id ?? "")) throw new Error("schema_drift");
  const item = { id, userId: id };
  optional(item, "displayName", row.user?.displayName ?? row.displayName, 200);
  optional(item, "joinedAt", row.joinedAt, 100);
  optional(item, "membershipStatus", row.membershipStatus, 64);
  if (row.roleIds !== undefined) {
    if (!Array.isArray(row.roleIds) || row.roleIds.length > 100)
      throw new Error("schema_drift");
    item.roleIds = row.roleIds.map((id) => string(id, 100));
  }
  return item;
}
export async function readClubProviderJob(job, provider, clock = Date.now) {
  try {
    const params = job.params;
    const requirement = requirements[params?.kind];
    if (!requirement || !job.enabledFeatures.includes(requirement[0]))
      throw new Error("feature_disabled");
    const authority = await provider.readAuthority();
    if (
      authority.groupId !== job.groupId ||
      authority.userId !== job.expectedUserId ||
      authority.membershipStatus !== "member" ||
      !Number.isFinite(authority.observedAt) ||
      authority.observedAt > clock() ||
      clock() - authority.observedAt > 60_000
    )
      throw new Error("provider_authority");
    if (
      requirement
        .slice(1)
        .some(
          (p) =>
            !authority.permissions.includes("*") &&
            !authority.permissions.includes(p),
        )
    )
      throw new Error("provider_permissions");
    let page;
    if (params.kind === "invitation_eligibility") {
      if (!userId.test(params.userId ?? "") || params.n !== 1 || params.offset !== 0 || (params.worldId === undefined) !== (params.instanceId === undefined)) throw new Error("invalid_input");
      let friendship, destinationState;
      if (params.worldId !== undefined) {
        const evidence = await provider.getInstanceInviteEligibility({ targetUserId: params.userId, worldId: params.worldId, instanceId: params.instanceId });
        friendship = evidence.friendship;
        destinationState = evidence.destinationOpen ? "open" : "closed";
      } else {
        friendship = await provider.getFriendship(params.userId);
        destinationState = "pending";
      }
      page = { items: [{ userId: params.userId, friendship, destinationState }], nextOffset: null, observedAt: clock() };
    } else if (params.kind === "member") {
      if (!userId.test(params.userId ?? "")) throw new Error("invalid_input");
      page = {
        items: [await provider.getMember(params.userId)],
        nextOffset: null,
        observedAt: clock(),
      };
    } else {
      page = await provider.readPage(
        params.kind === "instance_roles" ? "roles" : params.kind,
        {
          n: params.n,
          offset: params.offset,
          ...(params.kind === "search" ? { search: params.search } : {}),
        },
      );
    }
    if (
      !Array.isArray(page.items) ||
      page.items.length > params.n ||
      (page.nextOffset !== null &&
        (page.items.length === 0 ||
          page.nextOffset !== params.offset + page.items.length))
    )
      throw new Error("schema_drift");
    const result = {
      items: page.items.map((row) => project(params.kind, row)),
      nextOffset: page.nextOffset,
      observedAt: page.observedAt,
    };
    if (JSON.stringify(result).length > 500_000)
      throw new Error("response_too_large");
    return {
      authority: {
        groupId: authority.groupId,
        userId: authority.userId,
        ...(authority.ownerUserId
          ? { ownerUserId: authority.ownerUserId }
          : {}),
        membershipStatus: authority.membershipStatus,
        permissions: authority.permissions,
        observedAt: authority.observedAt,
      },
      result,
    };
  } catch (error) {
    const code = error?.category ?? error?.message;
    return {
      errorCode:
        typeof code === "string" && /^[a-z_]{1,64}$/.test(code)
          ? code
          : "provider_read_failed",
    };
  }
}
