import assert from "node:assert/strict";
import test from "node:test";
import { readClubProviderJob } from "./club-read-jobs.mjs";
const id = "usr_11111111-1111-1111-1111-111111111111";
const now = 100_000;
const job = {
  groupId: "grp_example",
  expectedUserId: id,
  enabledFeatures: ["membership_management"],
  params: { kind: "members", n: 1, offset: 0 },
};
const authority = {
  groupId: job.groupId,
  userId: id,
  membershipStatus: "member",
  permissions: ["*"],
  observedAt: now,
};
test("budget-delayed reads refresh authority and fail closed on revocation or stale data", async () => {
  for (const mode of ["fresh", "revoked", "slow-refresh"]) {
    let time = now, reads = 0;
    const response = await readClubProviderJob(job, {
      readAuthority: async () => {
        reads++;
        if (reads > 1 && mode === "slow-refresh") time += 61_000;
        return {...authority, observedAt:time, permissions:reads > 1 && mode === "revoked" ? [] : ["*"]};
      },
      readPage: async () => {
        time += 61_000;
        return {items:[{userId:id}],nextOffset:null,observedAt:time};
      },
    }, () => time);
    assert.equal(reads,2);
    if (mode === "fresh") {
      assert.equal(response.authority.observedAt,time);
      assert.equal(response.result.items[0].id,id);
    } else {
      assert.equal(response.errorCode,mode === "revoked" ? "provider_permissions" : "provider_read_expired");
      assert.equal(response.result,undefined);
    }
  }
});

test("post reads preserve audience roles and reject malformed restrictions", async () => {
  const request = {...job, enabledFeatures:["posts"], params:{kind:"posts",n:1,offset:0}};
  for (const roleIds of [["grol_staff"], [], "grol_staff", [42], Array(101).fill("grol_staff")]) {
    const response = await readClubProviderJob(request, {
      readAuthority:async () => authority,
      readPage:async () => ({items:[{id:"post_example",title:"Staff post",roleIds}],nextOffset:null,observedAt:now}),
    }, () => now);
    if (Array.isArray(roleIds) && roleIds.length <= 100 && roleIds.every(id => typeof id === "string"))
      assert.deepEqual(response.result.items[0].roleIds,roleIds);
    else assert.equal(response.errorCode,"schema_drift");
  }
});

test("explicit invitation checks project friendship and never imply entry rights", async () => {
  const request = { ...job, enabledFeatures: ["instances"], params: { kind: "invitation_eligibility", userId: id, n: 1, offset: 0 } };
  let reads = 0;
  const provider = {
    readAuthority: async () => ({ ...authority, permissions: [] }),
    getFriendship: async (target) => { assert.equal(target, id); reads++; return "friend"; },
    getInstanceInviteEligibility: async () => ({ friendship: "friend", destinationOpen: false, rawSecret: "excluded" }),
  };
  const pending = await readClubProviderJob(request, provider, () => now);
  assert.deepEqual(pending.result.items, [{ id, userId: id, friendship: "friend", destinationState: "pending", invitationEligibility: "destination_pending" }]);
  assert.equal(reads, 1);
  const closed = await readClubProviderJob({ ...request, params: { ...request.params, worldId: "world", instanceId: "instance" } }, provider, () => now);
  assert.equal(closed.result.items[0].invitationEligibility, "destination_closed");
  assert.equal(JSON.stringify(closed).includes("rawSecret"), false);
  const rejected = await readClubProviderJob(request, { ...provider, readAuthority: async () => ({ ...authority, userId: "another-bot" }) }, () => now);
  assert.equal(rejected.errorCode, "provider_authority");
  assert.equal(reads, 1);
});
test("instance picker strips population and roster data and checks current membership", async () => {
  let reads = 0;
  const provider = {
    readAuthority: async () => ({ ...authority, permissions: [] }),
    readPage: async () => {
      reads++;
      return {
        items: [
          {
            location: "world:instance",
            world: { id: "world", name: "World", authorId: "private" },
            instanceId: "instance",
            memberCount: 40,
            users: [id],
          },
        ],
        nextOffset: null,
        observedAt: now,
      };
    },
  };
  const request = {
    ...job,
    enabledFeatures: ["instances"],
    params: { kind: "instances", n: 1, offset: 0 },
  };
  const result = await readClubProviderJob(request, provider, () => now);
  assert.deepEqual(result.result.items, [
    {
      id: "world:instance",
      worldId: "world",
      instanceId: "instance",
      name: "World",
    },
  ]);
  provider.readAuthority = async () => ({
    ...authority,
    membershipStatus: "inactive",
  });
  assert.equal(
    (await readClubProviderJob(request, provider, () => now)).errorCode,
    "provider_authority",
  );
  assert.equal(reads, 1);
});
test("instance role reads use instance feature and role endpoint without membership management", async () => {
  let kind;
  const result = await readClubProviderJob(
    {
      ...job,
      enabledFeatures: ["instances"],
      params: { ...job.params, kind: "instance_roles" },
    },
    {
      readAuthority: async () => ({
        ...authority,
        permissions: ["group-instance-restricted-create"],
      }),
      readPage: async (value) => {
        kind = value;
        return {
          items: [
            { id: "grol_one", name: "Performers", permissions: ["private"] },
          ],
          nextOffset: null,
          observedAt: now,
        };
      },
    },
    () => now,
  );
  assert.equal(kind, "roles");
  assert.deepEqual(result.result.items, [
    { id: "grol_one", name: "Performers" },
  ]);
});
test("projects member pages and preserves exact continuation without leaking user fields", async () => {
  const result = await readClubProviderJob(
    job,
    {
      readAuthority: async () => authority,
      readPage: async () => ({
        items: [
          {
            userId: id,
            user: {
              displayName: "Member",
              email: "private",
              location: "private",
            },
            roleIds: ["grol_example"],
            privateNotes: "hidden",
          },
        ],
        nextOffset: 1,
        observedAt: now,
      }),
    },
    () => now,
  );
  assert.deepEqual(result.result, {
    items: [
      { id, userId: id, displayName: "Member", roleIds: ["grol_example"] },
    ],
    nextOffset: 1,
    observedAt: now,
  });
});
test("checks feature and fresh own-member grants before fetching private rows", async () => {
  let reads = 0;
  const provider = {
    readAuthority: async () => ({ ...authority, permissions: [] }),
    readPage: async () => {
      reads++;
    },
  };
  assert.equal(
    (await readClubProviderJob(job, provider, () => now)).errorCode,
    "provider_permissions",
  );
  assert.equal(
    (
      await readClubProviderJob(
        { ...job, enabledFeatures: [] },
        provider,
        () => now,
      )
    ).errorCode,
    "feature_disabled",
  );
  provider.readAuthority = async () => ({ ...authority, observedAt: 0 });
  assert.equal(
    (await readClubProviderJob(job, provider, () => now)).errorCode,
    "provider_authority",
  );
  assert.equal(reads, 0);
});
test("rejects broken paging and never returns arbitrary provider error text", async () => {
  const provider = {
    readAuthority: async () => authority,
    readPage: async () => ({ items: [], nextOffset: 1, observedAt: now }),
  };
  assert.equal(
    (await readClubProviderJob(job, provider, () => now)).errorCode,
    "schema_drift",
  );
  provider.readPage = async () => {
    throw new Error("secret cookie in raw error");
  };
  assert.deepEqual(await readClubProviderJob(job, provider, () => now), {
    errorCode: "provider_read_failed",
  });
});
