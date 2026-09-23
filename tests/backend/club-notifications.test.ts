import assert from "node:assert/strict";
import { it } from "node:test";
import { recordClubOperationFailure } from "../../convex/_clubNotifications";
import type { MutationCtx } from "../../convex/_generated/server";
import type { Id } from "../../convex/_generated/dataModel";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import { notificationRecipient } from "../../convex/_clubNotifications";
import type { Doc } from "../../convex/_generated/dataModel";

it("records only terminal actionable outcomes and deduplicates each revision/outcome", async () => {
  const rows: any[] = [];
  let state = "pending";
  let revision = 1;
  const job = {
    _id: "job",
    communityProfileId: "club",
    get state() {
      return state;
    },
    get revision() {
      return revision;
    },
  };
  const ctx = {
    db: {
      get: async () => job,
      insert: async (_table: string, row: any) => {
        rows.push(row);
        return "notification";
      },
      query: () => ({
        withIndex: (_name: string, callback: any) => {
          const keys: Record<string, unknown> = {};
          const builder = {
            eq: (key: string, value: unknown) => {
              keys[key] = value;
              return builder;
            },
          };
          callback(builder);
          return {
            unique: async () =>
              rows.find((row) =>
                Object.entries(keys).every(
                  ([key, value]) => row[key] === value,
                ),
              ) ?? null,
          };
        },
      }),
    },
  } as unknown as MutationCtx;
  for (state of ["pending", "claimed", "submitted", "succeeded", "cancelled"])
    await recordClubOperationFailure(ctx, "job" as Id<"clubOperations">);
  assert.equal(rows.length, 0);
  for (state of ["rejected", "indeterminate", "missed"]) {
    await recordClubOperationFailure(ctx, "job" as Id<"clubOperations">);
    await recordClubOperationFailure(ctx, "job" as Id<"clubOperations">);
  }
  assert.equal(rows.length, 3);
  revision = 2;
  await recordClubOperationFailure(ctx, "job" as Id<"clubOperations">);
  assert.equal(rows.length, 4);
  assert.ok(
    rows.every(
      (row) =>
        row.emailState === "pending" && !("payload" in row) && !("code" in row),
    ),
  );
});

it("rechecks role access and routes a revoked initiator to the current owner", async () => {
  const old = process.env.CLERK_JWT_ISSUER_DOMAIN;
  process.env.CLERK_JWT_ISSUER_DOMAIN = "https://test.clerk.accounts.dev";
  try {
    const schema =
      (schemaModule as unknown as { default?: typeof schemaModule }).default ??
      schemaModule;
    const t = convexTest({
      schema,
      modules: {
        "../../convex/clubNotifications.ts": () =>
          import("../../convex/clubNotifications"),
        "../../convex/_generated/api.ts": () =>
          import("../../convex/_generated/api"),
      },
    });
    const { roleId, assignmentId } = await t.run(async (ctx) => {
      const now = Date.now();
      const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN!;
      const actor = {
        subject: "staff",
        issuer,
        tokenIdentifier: `${issuer}|staff`,
      };
      const profile = await ctx.db.insert("profiles", {
        slug: "notice-club",
        displayName: "Club",
        sortName: "club",
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
      const user = await ctx.db.insert("users", {
        clerkUserId: "owner",
        email: "owner@example.com",
        emailVerificationTime: now,
      });
      await ctx.db.insert("users", { clerkUserId: "staff" });
      await ctx.db.insert("profileOwners", {
        profileId: profile,
        userId: user,
        roleKey: "owner",
        state: "active",
        grantedAt: now,
        updatedAt: now,
      });
      const role = await ctx.db.insert("communityRoles", {
        communityProfileId: profile,
        key: "publisher",
        label: "Publisher",
        permissions: ["publish_posts"],
        assignableRoleIds: [],
        state: "active",
        createdAt: now,
        updatedAt: now,
      });
      const assignment = await ctx.db.insert("communityAuthorities", {
        communityProfileId: profile,
        subjectTokenIdentifier: actor.tokenIdentifier,
        subject: actor,
        roleId: role,
        state: "active",
        grantedAt: now,
        updatedAt: now,
      });
      const job = {
        communityProfileId: profile,
        actor,
        payload: { kind: "delete_post", postId: "post" },
      } as Doc<"clubOperations">;
      assert.equal(
        (await notificationRecipient(ctx.db, job))?.subject,
        "staff",
      );
      await ctx.db.patch(role, { permissions: [] });
      assert.equal(await notificationRecipient(ctx.db, job), null);
      await ctx.db.patch(assignment, { state: "revoked" });
      assert.equal(
        (await notificationRecipient(ctx.db, job))?.subject,
        "owner",
      );
      const integrationId = await ctx.db.insert("communityVrchatIntegrations", {
        communityProfileId: profile,
        vrchatGroupId: "grp_test",
        groupVisibility: "public",
        joinPolicy: "free",
        state: "active",
        killSwitchEnabled: false,
        requestsPerMinute: 10,
        leaseGeneration: 1,
        publicMetrics: {
          currentPopulation: false,
          populationHistory: false,
          groupMemberCount: false,
          groupMemberGrowth: false,
          eventRecaps: false,
        },
        consecutiveFailures: 0,
        createdAt: now,
        updatedAt: now,
      });
      for (let i = 0; i < 3; i++) {
        const operationId = await ctx.db.insert("clubOperations", {
          communityProfileId: profile,
          integrationId,
          epochStartedAt: now,
          requestId: `request-${i}`,
          batchId: "same-batch",
          payload: { kind: "delete_post", postId: `post-${i}` },
          schedule: { kind: "fixed", dueAt: now },
          dueAt: now,
          readyAt: now,
          actor,
          createdBy: actor,
          revision: 1,
          state: "rejected",
          createdAt: now,
          updatedAt: now,
        });
        await recordClubOperationFailure(ctx, operationId);
      }
      return { roleId: role, assignmentId: assignment };
    });
    const claim = makeFunctionReference<"mutation">(
      "clubNotifications:claimEmail",
    );
    const first = await t.mutation(claim, {});
    assert.equal(first.email, "owner@example.com");
    assert.equal(first.communitySlug, "notice-club");
    assert.equal(await t.mutation(claim, {}), null);
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("clubOperationNotifications").take(10);
      assert.equal(
        rows.filter((row) => row.emailState === "submitted").length,
        1,
      );
      assert.equal(
        rows.filter((row) => row.emailState === "suppressed").length,
        2,
      );
    });
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("clubOperationNotifications").take(10);
      const sentRow = rows.find((row) => row.emailState === "submitted")!;
      await ctx.db.patch(sentRow._id, { emailNextAttemptAt: Date.now() - 1 });
      const { _id, _creationTime, ...base } = sentRow;
      for (let i = 0; i < 100; i++)
        await ctx.db.insert("clubOperationNotifications", {
          ...base,
          revision: 999,
          emailState: "pending",
          emailRecipient: undefined,
          emailNextAttemptAt: Date.now() - 1000,
        });
      const job = await ctx.db.get(sentRow.operationId);
      const { _id: jobId, _creationTime: jobCreated, ...jobBase } = job!;
      const operationId = await ctx.db.insert("clubOperations", {
        ...jobBase,
        batchId: "later-batch",
        requestId: "later-request",
      });
      await recordClubOperationFailure(ctx, operationId);
    });
    // One bounded scan defers the ineligible prefix; the next scan reaches later work.
    assert.equal(await t.mutation(claim, {}), null);
    assert.equal((await t.mutation(claim, {})).email, "owner@example.com");
    await t.run(async (ctx) => {
      const original = await ctx.db.get(first.id);
      assert.equal(original!.emailState, "indeterminate");
      const stale = await ctx.db.query("clubOperationNotifications").take(110);
      for (const row of stale)
        if (row.revision === 999)
          await ctx.db.patch(row._id, { createdAt: Date.now() + 1000 });
    });
    const owner = t.withIdentity({
      subject: "owner",
      issuer: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      tokenIdentifier: `${process.env.CLERK_JWT_ISSUER_DOMAIN}|owner`,
    });
    const communityProfileId = await t.run(
      async (ctx) => (await ctx.db.get(first.id))!.communityProfileId,
    );
    const listRef = makeFunctionReference<"query">("clubNotifications:list");
    const page = await owner.query(listRef, {
      communityProfileId,
      paginationOpts: { numItems: 100, cursor: null },
    });
    assert.deepEqual(page.page, []);
    assert.equal(page.isDone, false);
    const later = await owner.query(listRef, {
      communityProfileId,
      paginationOpts: { numItems: 100, cursor: page.continueCursor },
    });
    assert.equal(later.page.length, 4);
    assert.equal(later.isDone, true);
    const markReadRef = makeFunctionReference<"mutation">(
      "clubNotifications:markRead",
    );
    const staff = t.withIdentity({
      subject: "staff",
      issuer: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      tokenIdentifier: `${process.env.CLERK_JWT_ISSUER_DOMAIN}|staff`,
    });
    const readState = async (identity: typeof owner) => {
      const result = await identity.query(listRef, {
        communityProfileId,
        paginationOpts: { numItems: 100, cursor: page.continueCursor },
      });
      return result.page.find((row: { id: typeof first.id }) => row.id === first.id)?.read;
    };
    // Revocation routes the notice to the owner, who dismisses it.
    assert.equal(await readState(owner), false);
    assert.equal(await readState(staff), undefined);
    await owner.mutation(markReadRef, { notificationId: first.id });
    await owner.mutation(markReadRef, { notificationId: first.id });
    assert.equal(await readState(owner), true);

    // Restoring the initiator's permission routes the same notice back to staff.
    await t.run(async (ctx) => {
      await ctx.db.patch(roleId, { permissions: ["publish_posts"] });
      await ctx.db.patch(assignmentId, { state: "active" });
    });
    assert.equal(await readState(owner), undefined);
    assert.equal(await readState(staff), false);
    await staff.mutation(markReadRef, { notificationId: first.id });
    await staff.mutation(markReadRef, { notificationId: first.id });
    assert.equal(await readState(staff), true);

    // Losing access again returns the notice to the owner without losing the read state.
    await t.run(async (ctx) => {
      await ctx.db.patch(assignmentId, { state: "revoked" });
      assert.deepEqual((await ctx.db.get(first.id))!.readBy, [
        `${process.env.CLERK_JWT_ISSUER_DOMAIN}|owner`,
        `${process.env.CLERK_JWT_ISSUER_DOMAIN}|staff`,
      ]);
    });
    assert.equal(await readState(owner), true);
    assert.equal(await readState(staff), undefined);
  } finally {
    if (old === undefined) delete process.env.CLERK_JWT_ISSUER_DOMAIN;
    else process.env.CLERK_JWT_ISSUER_DOMAIN = old;
  }
});
