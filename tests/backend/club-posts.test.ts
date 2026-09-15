import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/clubPosts.ts": () => import("../../convex/clubPosts"),
  "../../convex/clubOperations.ts": () => import("../../convex/clubOperations"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
};
const ref = (name: string) =>
  makeFunctionReference<"mutation">(`clubPosts:${name}`);
const list = makeFunctionReference<"query">("clubPosts:list");
const content = {
  title: "Tonight",
  text: "Doors at eight.",
  visibility: "group" as const,
  sendNotification: false,
};
async function setup() {
  const t = convexTest({ schema, modules }),
    now = Date.now();
  const identity = (subject: string) => ({
    subject,
    issuer: "https://test.clerk.accounts.dev",
    tokenIdentifier: `https://test.clerk.accounts.dev|${subject}`,
  });
  const ids = await t.run(async (ctx) => {
    const communityProfileId = await ctx.db.insert("profiles", {
      slug: "posts",
      displayName: "Posts",
      sortName: "posts",
      aliases: [],
      tags: [],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      updatedAt: now,
      profileType: "community",
      community: { categoryTags: [] },
    });
    const roleId = await ctx.db.insert("communityRoles", {
      communityProfileId,
      key: "publisher",
      label: "Publisher",
      permissions: ["publish_posts"],
      assignableRoleIds: [],
      state: "active",
      createdAt: now,
      updatedAt: now,
    });
    for (const name of ["publisher", "other"]) {
      const subject = identity(name);
      await ctx.db.insert("users", { clerkUserId: name });
      await ctx.db.insert("communityAuthorities", {
        communityProfileId,
        subjectTokenIdentifier: subject.tokenIdentifier,
        subject,
        roleId,
        state: "active",
        grantedAt: now,
        updatedAt: now,
      });
    }
    const integrationId = await ctx.db.insert("communityVrchatIntegrations", {
      communityProfileId,
      vrchatGroupId: "grp_11111111-1111-1111-1111-111111111111",
      groupVisibility: "public",
      joinPolicy: "free",
      state: "active",
      killSwitchEnabled: false,
      requestsPerMinute: 30,
      leaseGeneration: 0,
      publicMetrics: {
        currentPopulation: false,
        populationHistory: false,
        groupMemberCount: false,
        groupMemberGrowth: false,
        eventRecaps: false,
      },
      consecutiveFailures: 0,
      enabledFeatures: ["posts"],
      createdAt: now,
      updatedAt: now,
    });
    return { communityProfileId, roleId, integrationId };
  });
  return {
    t,
    ...ids,
    publisher: t.withIdentity(identity("publisher")),
    other: t.withIdentity(identity("other")),
  };
}
it("saves unfinished drafts idempotently, rejects stale edits and isolates creators", async () => {
  const { publisher, other, communityProfileId } = await setup();
  const draft = await publisher.mutation(ref("save"), {
    communityProfileId,
    clientId: "draft_client",
    content,
  });
  assert.equal(
    (
      await publisher.mutation(ref("save"), {
        communityProfileId,
        clientId: "draft_client",
        content,
      })
    ).id,
    draft.id,
  );
  const updated = await publisher.mutation(ref("save"), {
    communityProfileId,
    clientId: "draft_client",
    draftId: draft.id,
    expectedRevision: 1,
    content: { ...content, text: "" },
  });
  assert.equal(updated.revision, 2);
  await assert.rejects(
    publisher.mutation(ref("save"), {
      communityProfileId,
      clientId: "draft_client",
      draftId: draft.id,
      expectedRevision: 1,
      content,
    }),
    /changed/,
  );
  assert.equal(
    (
      await other.query(list, {
        communityProfileId,
        paginationOpts: { numItems: 20, cursor: null },
      })
    ).page.length,
    0,
  );
  await assert.rejects(
    other.mutation(ref("remove"), {
      communityProfileId,
      draftId: draft.id,
      expectedRevision: 2,
    }),
    /not found/,
  );
});
it("queues a frozen revision atomically once and rechecks feature and permission revocation", async () => {
  const { t, publisher, communityProfileId, roleId, integrationId } =
    await setup();
  const draft = await publisher.mutation(ref("save"), {
    communityProfileId,
    clientId: "queue_client",
    content,
  });
  const args = {
    communityProfileId,
    draftId: draft.id,
    expectedRevision: 1,
    schedule: { kind: "fixed", dueAt: Date.now() + 60000 },
  };
  const id = await publisher.mutation(ref("queue"), args);
  assert.equal(await publisher.mutation(ref("queue"), args), id);
  assert.equal(
    (await t.run((ctx) => ctx.db.query("clubOperations").take(10))).length,
    1,
  );
  await assert.rejects(
    publisher.mutation(ref("save"), {
      communityProfileId,
      clientId: "queue_client",
      draftId: draft.id,
      expectedRevision: 1,
      content,
    }),
    /queued/,
  );
  await t.run((ctx) => ctx.db.patch(integrationId, { enabledFeatures: [] }));
  await assert.rejects(publisher.mutation(ref("queue"), args), /disabled/);
  await t.run((ctx) =>
    ctx.db.patch(integrationId, { enabledFeatures: ["posts"] }),
  );
  await t.run((ctx) => ctx.db.patch(roleId, { permissions: [] }));
  await assert.rejects(publisher.mutation(ref("queue"), args));
});
it("invalid publication leaves the draft unqueued", async () => {
  const { t, publisher, communityProfileId } = await setup();
  const draft = await publisher.mutation(ref("save"), {
    communityProfileId,
    clientId: "empty_client",
    content: { ...content, text: "" },
  });
  await assert.rejects(
    publisher.mutation(ref("queue"), {
      communityProfileId,
      draftId: draft.id,
      expectedRevision: 1,
      schedule: { kind: "fixed", dueAt: Date.now() },
    }),
    /content/,
  );
  assert.equal(
    (await t.run((ctx) => ctx.db.get(draft.id)))?.operationId,
    undefined,
  );
});
it("preserves the provider post target and notification choice for queued edits", async () => {
  const { t, publisher, communityProfileId } = await setup();
  const providerPostId = "not_11111111-1111-1111-1111-111111111111";
  const draft = await publisher.mutation(ref("save"), {
    communityProfileId,
    clientId: "edit_client",
    content: { ...content, providerPostId, sendNotification: true },
  });
  const id = await publisher.mutation(ref("queue"), {
    communityProfileId,
    draftId: draft.id,
    expectedRevision: 1,
    schedule: { kind: "fixed", dueAt: Date.now() + 60000 },
  });
  const operation = await t.run((ctx) => ctx.db.get(id));
  assert.equal(operation?.payload.kind, "edit_post");
  assert.equal(operation?.payload.postId, providerPostId);
  assert.equal(operation?.payload.sendNotification, true);
});
