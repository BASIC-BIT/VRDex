import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import {
  getPublicCommunityHostedEvents,
  getPublicPersonUpcomingEvents,
} from "../../convex/_eventPublic";
import { getPublicActiveWorlds, getPublicWorldEventContext } from "../../convex/_worldEvents";
import schemaModule from "../../convex/schema";

import { newClerkUserId } from "./_clerkTestIdentity";
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/events.ts": () => import("../../convex/events"),
  "../../convex/profileAssets.ts": () => import("../../convex/profileAssets"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const NOW = Date.parse("2026-07-24T12:00:00.000Z");

async function seedOwnedCommunity(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const clerkUserId = newClerkUserId();
    const userId = await ctx.db.insert("users", {
      clerkUserId: clerkUserId,
      name: "Community Owner",
      email: "owner@example.com",
      emailVerificationTime: NOW,
    });
    const profileId = await ctx.db.insert("profiles", {
      slug: "faceless",
      displayName: "The Faceless",
      sortName: "the faceless",
      aliases: [],
      tags: [],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      updatedAt: NOW,
      profileType: "community",
      community: { categoryTags: [] },
    });
    await ctx.db.insert("profileOwners", {
      profileId,
      userId,
      roleKey: "owner",
      state: "active",
      grantedAt: NOW,
      updatedAt: NOW,
    });

    return {
      profileId,
      userId,
      identity: {
        subject: clerkUserId, emailVerified: true,
        issuer: "test",
        tokenIdentifier: `test|${userId}`,
      },
    };
  });
}

async function seedUser(t: ReturnType<typeof convexTest>, name: string) {
  return t.run(async (ctx) => {
    const clerkUserId = newClerkUserId();
    const userId = await ctx.db.insert("users", {
      clerkUserId,
      name,
      email: `${name.toLowerCase().replace(/\s+/g, "-")}@example.com`,
      emailVerificationTime: NOW,
    });

    return {
      userId,
      identity: {
        subject: clerkUserId,
        emailVerified: true,
        issuer: "test",
        tokenIdentifier: `test|${userId}`,
      },
    };
  });
}

describe("API-created event ownership", () => {
  it("lets a current community owner create a private draft with an audit record", async () => {
    const t = convexTest({ schema, modules });
    const { identity } = await seedOwnedCommunity(t);

    const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Faceless Friday",
      communitySlug: "faceless",
      startAt: NOW + 86_400_000,
      summary: "Browser-authored draft.",
    });
    assert.equal(created.slug, "faceless-friday");
    assert.equal(created.eventPath, "/faceless/events/faceless-friday");
    const managed = await t.withIdentity(identity).query(api.events.listManagedCommunities, {});
    assert.deepEqual(managed.map((community) => community.slug), ["faceless"]);
    const managedEvents = await t.withIdentity(identity).query(api.events.listManagedEvents, {});
    assert.equal(managedEvents[0]?.title, "Faceless Friday");
    assert.equal(managedEvents[0]?.publicationState, "draft_private");
    const result = await t.run(async (ctx) => ({
      event: await ctx.db.get(created.eventId),
      audits: await ctx.db
        .query("eventAuditEvents")
        .withIndex("by_eventId_createdAt", (query) => query.eq("eventId", created.eventId))
        .collect(),
    }));

    assert.equal(result.event?.publicationState, "draft_private");
    assert.equal(result.event?.eventStatus, "scheduled");
    assert.equal(result.event?.publishedAt, undefined);
    assert.equal(result.audits.length, 1);
    assert.equal(result.audits[0]?.action, "created");
    assert.equal(result.audits[0]?.actorSurface, "browser");
    const history = await t.withIdentity(identity).query(api.events.listEventAudit, {
      currentSlug: created.slug,
    });
    assert.equal(history[0]?.action, "created");
    assert.equal("tokenIdentifier" in (history[0] ?? {}), false);
  });

  it("does not add private draft fields to public discovery vocabulary", async () => {
    const t = convexTest({ schema, modules });
    const { identity } = await seedOwnedCommunity(t);
    const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Private vocabulary draft",
      communitySlug: "faceless",
      startAt: NOW + 86_400_000,
    });
    await t.withIdentity(identity).mutation(api.events.updateCommunityEvent, {
      currentSlug: created.slug,
      title: "Private vocabulary draft",
      communitySlug: "faceless",
      startAt: NOW + 86_400_000,
      timezone: "Pacific/Honolulu",
    });
    const privateTimezoneVocabulary = await t.run((ctx) =>
      ctx.db
        .query("vocabularyTerms")
        .withIndex("by_scope_key", (query) =>
          query.eq("scope", "event_tag").eq("key", "pacific_honolulu"),
        )
        .unique(),
    );
    assert.equal(privateTimezoneVocabulary, null);
  });

  it("creates a published browser event atomically", async () => {
    const t = convexTest({ schema, modules });
    const { identity } = await seedOwnedCommunity(t);

    const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Published at creation",
      communitySlug: "faceless",
      startAt: NOW + 86_400_000,
      timezone: "Europe/Berlin",
      published: true,
    });
    const stored = await t.run((ctx) => ctx.db.get(created.eventId));

    assert.equal(stored?.publicationState, "published");
    assert.equal((await t.query(api.events.getPublicBySlug, { slug: created.slug }))?.title, "Published at creation");
    const timezoneVocabulary = await t.run((ctx) =>
      ctx.db
        .query("vocabularyTerms")
        .withIndex("by_scope_key", (query) =>
          query.eq("scope", "event_tag").eq("key", "europe_berlin"),
        )
        .unique(),
    );
    assert.equal(timezoneVocabulary?.usageCount, 1);
  });

  it("publishes, cancels, and restores an authorized draft without leaking cancelled discovery", async () => {
    const t = convexTest({ schema, modules });
    const { identity, profileId } = await seedOwnedCommunity(t);
    const startAt = NOW + 86_400_000;
    const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Faceless Saturday",
      communitySlug: "faceless",
      startAt,
      endAt: startAt + 3_600_000,
      timezone: "UTC",
    });
    const managed = await t.withIdentity(identity).query(api.events.listManagedCommunities, {});
    assert.deepEqual(managed.map((community) => community.slug), ["faceless"]);

    assert.equal(
      await t.query(api.events.getPublicBySlug, { slug: created.slug }),
      null,
    );
    const editable = await t.withIdentity(identity).query(api.events.getEditableBySlug, {
      slug: created.slug,
    });
    assert.equal(editable?.publicationState, "draft_private");

    await t.withIdentity(identity).mutation(api.events.setCommunityEventPublished, {
      currentSlug: created.slug,
      published: true,
    });
    const published = await t.query(api.events.getPublicBySlug, { slug: created.slug });
    assert.equal(published?.status, "scheduled");
    const timezoneVocabulary = await t.run((ctx) =>
      ctx.db
        .query("vocabularyTerms")
        .withIndex("by_scope_key", (query) => query.eq("scope", "event_tag").eq("key", "utc"))
        .unique(),
    );
    assert.equal(timezoneVocabulary?.label, "UTC");

    await assert.rejects(
      t.withIdentity(identity).mutation(api.events.setCommunityEventCancelled, {
        currentSlug: created.slug,
        cancelled: true,
      }),
      /cancellation reason is required/i,
    );
    await t.withIdentity(identity).mutation(api.events.setCommunityEventCancelled, {
      currentSlug: created.slug,
      cancelled: true,
      reason: "The venue is unavailable.",
    });
    assert.equal(
      (await t.query(api.events.getPublicBySlug, { slug: created.slug }))?.status,
      "cancelled",
    );
    assert.deepEqual(
      await t.query(api.events.listPublicUpcoming, { now: NOW, limit: 8 }),
      [],
    );
    const cancelledSearchDocument = await t.run((ctx) =>
      ctx.db
        .query("searchDocuments")
        .withIndex("by_eventId", (query) => query.eq("eventId", created.eventId))
        .unique(),
    );
    assert.equal(cancelledSearchDocument?.publicState, "hidden");
    assert.equal((await t.run((ctx) =>
      ctx.db
        .query("vocabularyTerms")
        .withIndex("by_scope_key", (query) => query.eq("scope", "event_tag").eq("key", "utc"))
        .unique(),
    ))?.usageCount, 0);

    await t.run((ctx) => ctx.db.patch(profileId, { publicSurfacingState: "opted_out" }));
    await assert.rejects(
      t.withIdentity(identity).mutation(api.events.setCommunityEventCancelled, {
        currentSlug: created.slug,
        cancelled: false,
      }),
      /event community must be public/i,
    );
    assert.deepEqual(
      await t.query(api.events.listPublicUpcoming, { now: NOW, limit: 8 }),
      [],
    );
    await t.run((ctx) => ctx.db.patch(profileId, { publicSurfacingState: "public" }));

    await t.withIdentity(identity).mutation(api.events.setCommunityEventCancelled, {
      currentSlug: created.slug,
      cancelled: false,
    });
    const upcoming = await t.query(api.events.listPublicUpcoming, { now: NOW, limit: 8 });
    assert.equal(upcoming[0]?.slug, created.slug);
    assert.equal(upcoming[0]?.status, "scheduled");
    const restoredSearchDocument = await t.run((ctx) =>
      ctx.db
        .query("searchDocuments")
        .withIndex("by_eventId", (query) => query.eq("eventId", created.eventId))
        .unique(),
    );
    assert.equal(restoredSearchDocument?.publicState, "public");
    assert.equal((await t.run((ctx) =>
      ctx.db
        .query("vocabularyTerms")
        .withIndex("by_scope_key", (query) => query.eq("scope", "event_tag").eq("key", "utc"))
        .unique(),
    ))?.usageCount, 1);
  });

  it("cancels scheduled media work and requests a stop for active media", async () => {
    const t = convexTest({ schema, modules });
    const { identity, userId } = await seedOwnedCommunity(t);
    const createMediaEvent = async (title: string) => {
      const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
        title,
        communitySlug: "faceless",
        startAt: NOW + 86_400_000,
      });
      await t.withIdentity(identity).mutation(api.events.configureVrcdnOutput, {
        currentSlug: created.slug,
        key: "main",
        label: "Main output",
        credentialRef: "vrcdn/main",
        sourceConsentAccepted: true,
        destinationAuthorityAccepted: true,
        providerRulesAccepted: true,
        rightsClearedMediaAccepted: true,
        playbackLinks: [{ platform: "browser", label: "Watch", url: "https://example.com/watch" }],
      });
      const scheduled = await t.withIdentity(identity).mutation(api.events.scheduleEventMediaWorker, {
        currentSlug: created.slug,
      });
      return { ...created, ...scheduled };
    };

    const configured = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Configured media event",
      communitySlug: "faceless",
      startAt: NOW + 86_400_000,
      published: true,
    });
    const configuredOutput = await t.withIdentity(identity).mutation(api.events.configureVrcdnOutput, {
      currentSlug: configured.slug,
      key: "main",
      label: "Main output",
      credentialRef: "vrcdn/main",
      sourceConsentAccepted: true,
      destinationAuthorityAccepted: true,
      providerRulesAccepted: true,
      rightsClearedMediaAccepted: true,
      playbackLinks: [{ platform: "browser", label: "Watch", url: "https://example.com/watch" }],
    });
    await t.withIdentity(identity).mutation(api.events.setCommunityEventCancelled, {
      currentSlug: configured.slug,
      cancelled: true,
      reason: "Cancelled before scheduling.",
    });
    const configuredState = await t.run(async (ctx) => ({
      program: await ctx.db.get(configuredOutput.programId),
      output: await ctx.db.get(configuredOutput.outputId),
    }));
    assert.equal(configuredState.program?.state, "ended");
    assert.equal(configuredState.program?.currentOutputId, undefined);
    assert.deepEqual(configuredState.program?.publicLinks, []);
    assert.equal(configuredState.output?.state, "disabled");
    assert.deepEqual((await t.query(api.events.getPublicBySlug, { slug: configured.slug }))?.mediaLinks, []);
    await assert.rejects(
      t.withIdentity(identity).mutation(api.events.configureVrcdnOutput, {
        currentSlug: configured.slug,
        key: "reopened",
        label: "Reopened output",
        credentialRef: "vrcdn/main",
        sourceConsentAccepted: true,
        destinationAuthorityAccepted: true,
        providerRulesAccepted: true,
        rightsClearedMediaAccepted: true,
        playbackLinks: [{ platform: "browser", label: "Watch", url: "https://example.com/watch" }],
      }),
      /cancelled event cannot configure/i,
    );
    assert.deepEqual((await t.query(api.events.getPublicBySlug, { slug: configured.slug }))?.mediaLinks, []);

    const queued = await createMediaEvent("Queued media event");
    await t.withIdentity(identity).mutation(api.events.setCommunityEventCancelled, {
      currentSlug: queued.slug,
      cancelled: true,
      reason: "Cancelled for test coverage.",
    });
    const queuedState = await t.run(async (ctx) => ({
      program: await ctx.db.get(queued.programId),
      session: await ctx.db.get(queued.sessionId),
      command: queued.startCommandId === undefined ? null : await ctx.db.get(queued.startCommandId),
    }));
    assert.equal(queuedState.program?.state, "ended");
    assert.deepEqual(queuedState.program?.publicLinks, []);
    assert.equal(queuedState.session?.status, "ended");
    assert.equal(queuedState.session?.workerTaskStatus, "stopped");
    assert.equal(queuedState.command?.status, "cancelled");
    assert.equal(
      (await t.query(internal.events.listCommunityManagedEventsForApiOwner, { ownerUserId: userId }))[0]?.status,
      "cancelled",
    );
    await assert.rejects(
      t.withIdentity(identity).mutation(api.events.scheduleEventMediaWorker, {
        currentSlug: queued.slug,
      }),
      /cancelled event cannot schedule/i,
    );

    const active = await createMediaEvent("Active media event");
    await t.run(async (ctx) => {
      await ctx.db.patch(active.sessionId, {
        status: "starting",
        workerTaskStatus: "starting",
        startedAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.patch(active.programId, {
        state: "starting",
        activeSessionId: active.sessionId,
        updatedAt: NOW,
      });
      if (active.startCommandId !== undefined) {
        await ctx.db.patch(active.startCommandId, {
          status: "claimed",
          claimedByWorkerId: "worker-1",
          claimedAt: NOW,
          updatedAt: NOW,
        });
      }
      for (let index = 0; index < 60; index += 1) {
        await ctx.db.insert("eventMediaSessions", {
          programId: active.programId,
          eventId: active.eventId,
          status: "ended",
          workerTaskStatus: "stopped",
          artifactLinks: [],
          createdAt: NOW - index - 1,
          updatedAt: NOW - index - 1,
        });
      }
    });
    await t.withIdentity(identity).mutation(api.events.setCommunityEventCancelled, {
      currentSlug: active.slug,
      cancelled: true,
      reason: "Cancelled while live.",
    });
    const activeState = await t.run(async (ctx) => ({
      program: await ctx.db.get(active.programId),
      session: await ctx.db.get(active.sessionId),
      commands: await ctx.db
        .query("eventMediaCommands")
        .withIndex("by_eventId_createdAt", (query) => query.eq("eventId", active.eventId))
        .collect(),
    }));
    assert.equal(activeState.program?.state, "stopping");
    assert.deepEqual(activeState.program?.publicLinks, []);
    assert.equal(activeState.session?.status, "stopping");
    assert.equal(activeState.session?.workerTaskStatus, "stopping");
    assert.equal(
      activeState.commands.find((command) => command.commandType === "start_program")?.status,
      "cancelled",
    );
    assert.equal(
      activeState.commands.find((command) => command.commandType === "stop_program")?.status,
      undefined,
    );

    const previousBridgeToken = process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN;
    process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN = "test-event-media-bridge-token";
    try {
      await t.mutation(api.events.recordEventMediaWorkerBridgeTaskStatus, {
        bridgeToken: "test-event-media-bridge-token",
        workerId: "worker-1",
        sessionId: active.sessionId,
        status: "starting",
        workerProvider: "aws_ecs",
        workerTaskId: "arn:aws:ecs:us-east-1:123456789012:task/cluster/task-after-cancel",
        workerTaskStatus: "starting",
      });
    } finally {
      if (previousBridgeToken === undefined) {
        delete process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN;
      } else {
        process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN = previousBridgeToken;
      }
    }
    const reportedState = await t.run(async (ctx) => ({
      session: await ctx.db.get(active.sessionId),
      commands: await ctx.db
        .query("eventMediaCommands")
        .withIndex("by_eventId_createdAt", (query) => query.eq("eventId", active.eventId))
        .collect(),
    }));
    assert.equal(reportedState.session?.status, "stopping");
    assert.equal(reportedState.session?.workerTaskStatus, "stopping");
    assert.equal(
      reportedState.commands.find((command) => command.commandType === "stop_program")?.status,
      "queued",
    );

    await t.withIdentity(identity).mutation(api.events.recordEventMediaWorkerTaskStatus, {
      currentSlug: active.slug,
      sessionId: active.sessionId,
      status: "live",
      workerTaskStatus: "running",
    });
    const operatorReportedState = await t.run(async (ctx) => ({
      program: await ctx.db.get(active.programId),
      session: await ctx.db.get(active.sessionId),
    }));
    assert.equal(operatorReportedState.program?.state, "stopping");
    assert.deepEqual(operatorReportedState.program?.publicLinks, []);
    assert.equal(operatorReportedState.session?.status, "stopping");
    assert.equal(operatorReportedState.session?.workerTaskStatus, "stopping");
  });

  it("never publishes stale media outputs for a cancelled event", async () => {
    const t = convexTest({ schema, modules });
    const { identity } = await seedOwnedCommunity(t);
    const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Cancelled stale output",
      communitySlug: "faceless",
      startAt: NOW + 86_400_000,
      mediaLinks: [
        { type: "watch", label: "Watch", url: "https://example.com/authored-watch" },
        { type: "ticket", label: "Tickets", url: "https://example.com/tickets" },
      ],
      published: true,
    });
    await t.withIdentity(identity).mutation(api.events.setCommunityEventCancelled, {
      currentSlug: created.slug,
      cancelled: true,
      reason: "Cancelled for test coverage.",
    });
    await t.run(async (ctx) => {
      const playbackLinks = [
        { platform: "browser" as const, label: "Watch", url: "https://example.com/stale" },
      ];
      const programId = await ctx.db.insert("eventMediaPrograms", {
        eventId: created.eventId,
        state: "ready",
        publicLinks: playbackLinks,
        directFallbackLinks: [],
        createdAt: NOW,
        updatedAt: NOW,
      });
      const outputId = await ctx.db.insert("eventMediaOutputs", {
        programId,
        eventId: created.eventId,
        key: "stale",
        type: "vrcdn",
        accountModel: "operator_owned",
        state: "ready",
        label: "Stale output",
        playbackLinks,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.patch(programId, { currentOutputId: outputId });
    });

    const publicEvent = await t.query(api.events.getPublicBySlug, { slug: created.slug });
    const editableEvent = await t.withIdentity(identity).query(api.events.getEditableBySlug, {
      slug: created.slug,
    });
    assert.equal(publicEvent?.status, "cancelled");
    assert.deepEqual(publicEvent?.authoredMediaLinks.map((link) => link.type), ["ticket"]);
    assert.deepEqual(publicEvent?.mediaLinks.map((link) => link.type), ["ticket"]);
    assert.deepEqual(editableEvent?.authoredMediaLinks.map((link) => link.type), ["watch", "ticket"]);
  });

  it("does not reschedule a worker after its start command has been claimed", async () => {
    const t = convexTest({ schema, modules });
    const { identity } = await seedOwnedCommunity(t);
    const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Claimed worker start",
      communitySlug: "faceless",
      startAt: NOW + 86_400_000,
    });
    await t.withIdentity(identity).mutation(api.events.configureVrcdnOutput, {
      currentSlug: created.slug,
      key: "main",
      label: "Main output",
      credentialRef: "vrcdn/main",
      sourceConsentAccepted: true,
      destinationAuthorityAccepted: true,
      providerRulesAccepted: true,
      rightsClearedMediaAccepted: true,
      playbackLinks: [],
    });
    const scheduled = await t.withIdentity(identity).mutation(api.events.scheduleEventMediaWorker, {
      currentSlug: created.slug,
    });
    assert.ok(scheduled.startCommandId);
    await t.run((ctx) =>
      ctx.db.patch(scheduled.startCommandId!, {
        status: "claimed",
        claimedByWorkerId: "worker-1",
        claimedAt: NOW,
        updatedAt: NOW,
      }),
    );
    const before = await t.run((ctx) => ctx.db.get(scheduled.sessionId));

    await assert.rejects(
      t.withIdentity(identity).mutation(api.events.scheduleEventMediaWorker, {
        currentSlug: created.slug,
        scheduledStartAt: (before?.scheduledStartAt ?? NOW) + 60_000,
      }),
      /start is already in progress/i,
    );
    const after = await t.run((ctx) => ctx.db.get(scheduled.sessionId));
    assert.equal(after?.scheduledStartAt, before?.scheduledStartAt);
  });

  it("claims only due lifecycle commands and lets a restarted bridge reconcile prior tasks", async () => {
    const previousBridgeToken = process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN;
    process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN = "test-event-media-bridge-token";

    try {
      const t = convexTest({ schema, modules });
      const { identity } = await seedOwnedCommunity(t);
      const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
        title: "Future media event",
        communitySlug: "faceless",
        startAt: Date.now() + 86_400_000,
      });
      await t.withIdentity(identity).mutation(api.events.configureVrcdnOutput, {
        currentSlug: created.slug,
        key: "main",
        label: "Main output",
        credentialRef: "vrcdn/main",
        sourceConsentAccepted: true,
        destinationAuthorityAccepted: true,
        providerRulesAccepted: true,
        rightsClearedMediaAccepted: true,
        playbackLinks: [{ platform: "browser", label: "Watch", url: "https://example.com/watch" }],
      });
      const scheduled = await t.withIdentity(identity).mutation(api.events.scheduleEventMediaWorker, {
        currentSlug: created.slug,
      });
      assert.ok(scheduled.startCommandId);
      const now = Date.now();

      await t.run(async (ctx) => {
        for (let index = 0; index < 50; index += 1) {
          await ctx.db.insert("eventMediaCommands", {
            programId: scheduled.programId,
            eventId: created.eventId,
            commandType: "switch_next",
            status: "queued",
            actorSurface: "web",
            publicFallbackLinks: [],
            availableAt: now - 1_000,
            createdAt: now - 1_000 + index,
            updatedAt: now - 1_000 + index,
          });
        }
      });

      assert.equal(
        await t.mutation(api.events.claimEventMediaWorkerCommand, {
          bridgeToken: "test-event-media-bridge-token",
          workerId: "new-bridge",
        }),
        null,
      );

      const stopCommandId = await t.run((ctx) =>
        ctx.db.insert("eventMediaCommands", {
          programId: scheduled.programId,
          eventId: created.eventId,
          sessionId: scheduled.sessionId,
          commandType: "stop_program",
          status: "queued",
          actorSurface: "worker",
          publicFallbackLinks: [],
          availableAt: now - 1,
          createdAt: now,
          updatedAt: now,
        }),
      );
      const claimedStop = await t.mutation(api.events.claimEventMediaWorkerCommand, {
        bridgeToken: "test-event-media-bridge-token",
        workerId: "new-bridge",
      });
      assert.equal(claimedStop?.commandId, stopCommandId);
      assert.equal(claimedStop?.commandType, "stop_program");
      assert.equal(
        await t.mutation(api.events.claimEventMediaWorkerCommand, {
          bridgeToken: "test-event-media-bridge-token",
          workerId: "new-bridge",
        }),
        null,
      );

      await t.run(async (ctx) => {
        await ctx.db.patch(scheduled.startCommandId!, { availableAt: now - 1 });
        await ctx.db.patch(scheduled.sessionId, {
          status: "starting",
          workerId: "old-bridge",
          workerProvider: "aws_ecs",
          workerTaskId: "arn:aws:ecs:us-east-1:123456789012:task/cluster/task-1",
          workerTaskDefinitionArn: "arn:aws:ecs:us-east-1:123456789012:task-definition/vrdex-worker:1",
          workerTaskStatus: "starting",
          updatedAt: now,
        });
      });

      const sessions = await t.query(api.events.listEventMediaWorkerBridgeSessions, {
        bridgeToken: "test-event-media-bridge-token",
        workerId: "new-bridge",
      });
      assert.deepEqual(sessions.map((session) => session.sessionId), [scheduled.sessionId]);

      const claimedStart = await t.mutation(api.events.claimEventMediaWorkerCommand, {
        bridgeToken: "test-event-media-bridge-token",
        workerId: "new-bridge",
      });
      assert.equal(claimedStart?.commandId, scheduled.startCommandId);
      assert.equal(claimedStart?.commandType, "start_program");
    } finally {
      if (previousBridgeToken === undefined) {
        delete process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN;
      } else {
        process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN = previousBridgeToken;
      }
    }
  });

  it("fills the requested discovery limit after excluding cancelled events", async () => {
    const t = convexTest({ schema, modules });
    const { identity } = await seedOwnedCommunity(t);
    const first = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Cancelled opener",
      communitySlug: "faceless",
      startAt: NOW + 3_600_000,
    });
    const second = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Scheduled headliner",
      communitySlug: "faceless",
      startAt: NOW + 7_200_000,
    });
    await t.withIdentity(identity).mutation(api.events.setCommunityEventPublished, {
      currentSlug: first.slug,
      published: true,
    });
    await t.withIdentity(identity).mutation(api.events.setCommunityEventPublished, {
      currentSlug: second.slug,
      published: true,
    });
    await t.withIdentity(identity).mutation(api.events.setCommunityEventCancelled, {
      currentSlug: first.slug,
      cancelled: true,
      reason: "Cancelled for test coverage.",
    });

    const upcoming = await t.query(api.events.listPublicUpcoming, { now: NOW, limit: 1 });
    assert.deepEqual(upcoming.map((event) => event.slug), [second.slug]);
  });

  it("keeps a long-running event after more than 80 newer events have ended", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      await ctx.db.insert("events", {
        slug: "weeklong-festival",
        title: "Weeklong Festival",
        sortTitle: "weeklong festival",
        startAt: NOW - 7 * 86_400_000,
        endAt: NOW + 3_600_000,
        sourceType: "manual",
        sourceLabel: "Test",
        eventStatus: "scheduled",
        publicationState: "published",
        publishedAt: NOW - 7 * 86_400_000,
        updatedAt: NOW,
      });
      for (let index = 0; index < 81; index += 1) {
        const startAt = NOW - (index + 1) * 60_000;
        await ctx.db.insert("events", {
          slug: `ended-event-${index}`,
          title: `Ended Event ${index}`,
          sortTitle: `ended event ${index}`,
          startAt,
          endAt: startAt + 30_000,
          sourceType: "manual",
          sourceLabel: "Test",
          eventStatus: "scheduled",
          publicationState: "published",
          publishedAt: startAt,
          updatedAt: startAt,
        });
      }
      for (let index = 0; index < 3; index += 1) {
        await ctx.db.insert("events", {
          slug: `future-short-event-${index}`,
          title: `Future Short Event ${index}`,
          sortTitle: `future short event ${index}`,
          startAt: NOW + (index + 1) * 60_000,
          endAt: NOW + (index + 4) * 60_000,
          sourceType: "manual",
          sourceLabel: "Test",
          eventStatus: "scheduled",
          publicationState: "published",
          publishedAt: NOW,
          updatedAt: NOW,
        });
      }
    });

    const upcoming = await t.query(api.events.listPublicUpcoming, { now: NOW, limit: 1 });
    assert.deepEqual(upcoming.map((event) => event.slug), ["weeklong-festival"]);
  });

  it("orders current events by effective end before future events", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      for (const event of [
        { slug: "long-current", startAt: NOW - 7_200_000, endAt: NOW + 7_200_000 },
        { slug: "short-current", startAt: NOW - 3_600_000, endAt: NOW + 3_600_000 },
        { slug: "future-event", startAt: NOW + 1_800_000, endAt: NOW + 10_800_000 },
      ]) {
        await ctx.db.insert("events", {
          ...event,
          title: event.slug,
          sortTitle: event.slug,
          sourceType: "manual",
          sourceLabel: "Test",
          eventStatus: "scheduled",
          publicationState: "published",
          publishedAt: NOW,
          updatedAt: NOW,
        });
      }
    });

    const upcoming = await t.query(api.events.listPublicUpcoming, { now: NOW, limit: 3 });
    assert.deepEqual(upcoming.map((event) => event.slug), [
      "short-current",
      "long-current",
      "future-event",
    ]);
  });

  it("keeps eligible profile and world events bounded and current-first", async () => {
    const t = convexTest({ schema, modules });
    const { profileId: communityProfileId } = await seedOwnedCommunity(t);
    const { personProfileId, worldId } = await t.run(async (ctx) => {
      const personProfileId = await ctx.db.insert("profiles", {
        slug: "long-running-dj",
        displayName: "Long Running DJ",
        sortName: "long running dj",
        aliases: [],
        tags: [],
        claimState: "unclaimed",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "community",
        updatedAt: NOW,
        profileType: "person",
        person: { roleTags: ["DJ"] },
      });
      const worldId = await ctx.db.insert("worlds", {
        slug: "long-running-world",
        displayName: "Long Running World",
        sortName: "long running world",
        tags: [],
        visibilityStatus: "public",
        platformCompatibility: [],
        media: [],
        creatorAttributions: [],
        outboundLinks: [],
        publicationState: "published",
        creationSource: "community",
        updatedAt: NOW,
      });
      const insertEvent = async (
        slug: string,
        title: string,
        startAt: number,
        endAt: number,
        eventStatus: "scheduled" | "cancelled" = "scheduled",
      ) => {
        const eventId = await ctx.db.insert("events", {
          slug,
          title,
          sortTitle: title.toLowerCase(),
          communityProfileId,
          startAt,
          endAt,
          sourceType: "manual",
          sourceLabel: "Test",
          eventStatus,
          publicationState: "published",
          publishedAt: startAt,
          updatedAt: startAt,
        });
        await ctx.db.insert("eventParticipants", {
          eventId,
          personProfileId,
          eventStartAt: startAt,
          eventEndAt: endAt,
          eventPublicationState: "published",
          eventStatus,
          roleLabel: "DJ",
          sourceType: "manual",
          sourceLabel: "Test",
          confirmationState: "confirmed",
          confirmedAt: startAt,
          updatedAt: startAt,
        });
        await ctx.db.insert("eventWorlds", {
          eventId,
          worldId,
          eventStartAt: startAt,
          eventEndAt: endAt,
          eventPublicationState: "published",
          eventStatus,
          sourceType: "manual",
          confidence: 1,
          confirmationState: "confirmed",
          confirmedAt: startAt,
          updatedAt: startAt,
        });
      };

      await insertEvent(
        "profile-weeklong-festival",
        "Profile Weeklong Festival",
        NOW - 7 * 86_400_000,
        NOW + 3_600_000,
      );
      await insertEvent(
        "profile-short-ongoing-event",
        "Profile Short Ongoing Event",
        NOW - 3_600_000,
        NOW + 30 * 60_000,
      );
      for (let index = 0; index < 81; index += 1) {
        const startAt = NOW + (index + 1) * 1_000;
        await insertEvent(
          `profile-near-future-event-${index}`,
          `Profile Near Future Event ${index}`,
          startAt,
          startAt + 500,
        );
      }
      for (let index = 0; index < 81; index += 1) {
        const startAt = NOW - (index + 1) * 60_000;
        await insertEvent(
          `profile-ended-event-${index}`,
          `Profile Ended Event ${index}`,
          startAt,
          startAt + 30_000,
        );
      }
      await insertEvent(
        "profile-future-festival",
        "Profile Future Festival",
        NOW + 45 * 60_000,
        NOW + 50 * 60_000,
      );
      for (let index = 0; index < 81; index += 1) {
        const startAt = NOW + (index + 1) * 60_000;
        await insertEvent(
          `profile-cancelled-event-${index}`,
          `Profile Cancelled Event ${index}`,
          startAt,
          startAt + 30_000,
          "cancelled",
        );
      }

      return { personProfileId, worldId };
    });

    const associations = await t.run(async (ctx) => ({
      hosted: await getPublicCommunityHostedEvents(ctx.db, communityProfileId, NOW, 3),
      participant: await getPublicPersonUpcomingEvents(ctx.db, personProfileId, NOW, 3),
      world: await getPublicWorldEventContext(ctx.db, worldId, NOW),
      activeWorlds: await getPublicActiveWorlds(ctx.db, NOW, 3),
    }));
    assert.deepEqual(associations.hosted.map((event) => event.slug), [
      "profile-short-ongoing-event",
      "profile-weeklong-festival",
      "profile-near-future-event-0",
    ]);
    assert.deepEqual(associations.participant.map((event) => event.slug), [
      "profile-short-ongoing-event",
      "profile-weeklong-festival",
      "profile-near-future-event-0",
    ]);
    assert.deepEqual(associations.world.upcoming.map((event) => event.slug), [
      "profile-short-ongoing-event",
      "profile-weeklong-festival",
      "profile-near-future-event-0",
      "profile-near-future-event-1",
    ]);
    assert.deepEqual(associations.activeWorlds.map((world) => world.slug), [
      "long-running-world",
    ]);
  });

  it("deduplicates future events with end times before applying the limit", async () => {
    const t = convexTest({ schema, modules });
    const { identity } = await seedOwnedCommunity(t);
    const first = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Future opener",
      communitySlug: "faceless",
      startAt: NOW + 3_600_000,
      endAt: NOW + 7_200_000,
      published: true,
    });
    const second = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Future closer",
      communitySlug: "faceless",
      startAt: NOW + 10_800_000,
      endAt: NOW + 14_400_000,
      published: true,
    });

    const upcoming = await t.query(api.events.listPublicUpcoming, { now: NOW, limit: 2 });
    assert.deepEqual(upcoming.map((event) => event.slug), [first.slug, second.slug]);
  });

  it("uses a community primary logo on event cards", async () => {
    const t = convexTest({ schema, modules });
    const { identity, profileId } = await seedOwnedCommunity(t);
    const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Logo event",
      communitySlug: "faceless",
      startAt: NOW + 3_600_000,
      published: true,
    });
    await t.run(async (ctx) => {
      const assetId = await ctx.db.insert("profileAssets", {
        profileId,
        storageKey: "profile-assets/community-logo.webp",
        mimeType: "image/webp",
        byteSize: 512,
        visibility: "public",
        source: "community_submitted",
        uploadedBy: { tokenIdentifier: "test:contributor", issuer: "test", subject: "contributor" },
        uploadedAt: NOW,
        state: "active",
        updatedAt: NOW,
      });
      await ctx.db.insert("profileAssetPlacements", {
        profileId,
        assetId,
        placement: "primary_logo",
        position: 0,
        state: "active",
        updatedAt: NOW,
      });
    });

    const profile = await t.query(api.profileAssets.listPublicBySlug, { slug: "faceless" });
    const event = await t.query(api.events.getPublicBySlug, { slug: created.slug });
    assert.equal(event?.communityImageUrl, profile?.mediaKit.primaryLogo?.imageUrl);
  });

  it("keeps unlisted profile media off event host and lineup cards", async () => {
    const t = convexTest({ schema, modules });
    const { identity, profileId } = await seedOwnedCommunity(t);
    const startAt = NOW + 3_600_000;
    const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Unlisted media event",
      communitySlug: "faceless",
      startAt,
      endAt: startAt + 3_600_000,
      published: true,
    });
    const personId = await t.run(async (ctx) => {
      await ctx.db.patch(profileId, { fieldVisibility: { avatarImageUrl: "unlisted" } });
      const id = await ctx.db.insert("profiles", {
        profileType: "person",
        slug: "unlisted-dj",
        displayName: "Unlisted DJ",
        sortName: "unlisted dj",
        aliases: [],
        tags: [],
        claimState: "unclaimed",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "community",
        fieldVisibility: { avatarImageUrl: "unlisted" },
        person: { roleTags: ["DJ"] },
        updatedAt: NOW,
      });
      for (const [targetProfileId, key] of [[profileId, "host"], [id, "dj"]] as const) {
        const assetId = await ctx.db.insert("profileAssets", {
          profileId: targetProfileId,
          storageKey: `profile-assets/${key}.webp`,
          mimeType: "image/webp",
          byteSize: 512,
          visibility: "public",
          source: "owner_authored",
          uploadedBy: { tokenIdentifier: "test:owner", issuer: "test", subject: "owner" },
          uploadedAt: NOW,
          state: "active",
          updatedAt: NOW,
        });
        await ctx.db.insert("profileAssetPlacements", {
          profileId: targetProfileId,
          assetId,
          placement: "profile_image",
          position: 0,
          state: "active",
          updatedAt: NOW,
        });
      }
      await ctx.db.insert("eventParticipants", {
        eventId: created.eventId,
        personProfileId: id,
        eventStartAt: startAt,
        eventEndAt: startAt + 3_600_000,
        eventPublicationState: "published",
        eventStatus: "scheduled",
        roleLabel: "Performer",
        sourceType: "community",
        sourceLabel: "Test lineup",
        confirmationState: "confirmed",
        updatedAt: NOW,
      });
      await ctx.db.insert("eventSlots", {
        eventId: created.eventId,
        eventStartAt: startAt,
        position: 0,
        startAt,
        endAt: startAt + 3_600_000,
        personProfileId: id,
        displayLabel: "Unlisted DJ",
        roleLabel: "DJ",
        sourceType: "community",
        sourceLabel: "Test lineup",
        confidence: 1,
        reviewState: "confirmed",
        updatedAt: NOW,
      });
      return id;
    });

    assert.ok((await t.query(api.profileAssets.listPublicBySlug, { slug: "faceless" }))?.mediaKit.profileImage);
    assert.ok((await t.query(api.profileAssets.listPublicBySlug, { slug: "unlisted-dj" }))?.mediaKit.profileImage);
    const publicEvent = await t.query(api.events.getPublicBySlug, { slug: created.slug });
    assert.equal(publicEvent?.communityImageUrl, undefined);
    assert.equal(publicEvent?.participants.find((participant) => participant.profileId === personId)?.imageUrl, undefined);
    assert.equal(publicEvent?.slots[0]?.performer?.imageUrl, undefined);
  });

  it("keeps hidden associations private and preserves them across editor saves", async () => {
    const t = convexTest({ schema, modules });
    const { identity, profileId, userId } = await seedOwnedCommunity(t);
    const startAt = NOW + 3_600_000;
    const { personId, worldId } = await t.run(async (ctx) => ({
      personId: await ctx.db.insert("profiles", {
        profileType: "person",
        slug: "hidden-dj",
        displayName: "Hidden DJ",
        sortName: "hidden dj",
        aliases: [],
        tags: [],
        claimState: "unclaimed",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "community",
        person: { roleTags: ["DJ"] },
        updatedAt: NOW,
      }),
      worldId: await ctx.db.insert("worlds", {
        slug: "hidden-club",
        displayName: "Hidden Club",
        sortName: "hidden club",
        tags: [],
        visibilityStatus: "public",
        platformCompatibility: [],
        media: [],
        creatorAttributions: [],
        outboundLinks: [],
        publicationState: "published",
        creationSource: "community",
        updatedAt: NOW,
      }),
    }));
    const created = await t.mutation(internal.events.createCommunityEventForApiOwner, {
      actorKind: "personal_api_token",
      ownerUserId: userId,
      title: "Hidden association event",
      communitySlug: "faceless",
      startAt,
      timezone: "UTC",
    });

    const editableWhilePublic = await t.withIdentity(identity).query(api.events.getEditableBySlug, {
      slug: created.slug,
    });
    assert.equal(editableWhilePublic?.communitySlug, "faceless");
    assert.equal(editableWhilePublic?.preservedCommunityProfileId, profileId);
    assert.equal(editableWhilePublic?.preservedParticipantAssociationIds.length, 0);
    assert.equal(editableWhilePublic?.preservedSlotAssociationIds.length, 0);
    assert.equal(editableWhilePublic?.preservedWorldAssociationIds.length, 0);

    const savedWithAssociations = await t.withIdentity(identity).mutation(
      api.events.updateCommunityEvent,
      {
        currentSlug: created.slug,
        title: "Added associations in the open editor",
        communitySlug: editableWhilePublic!.communitySlug,
        preservedCommunityProfileId: editableWhilePublic!.preservedCommunityProfileId,
        preservedParticipantAssociationIds: editableWhilePublic!.preservedParticipantAssociationIds,
        preservedSlotAssociationIds: editableWhilePublic!.preservedSlotAssociationIds,
        preservedWorldAssociationIds: editableWhilePublic!.preservedWorldAssociationIds,
        worldSlug: "hidden-club",
        startAt,
        timezone: "UTC",
        participantLinks: [{ personSlug: "hidden-dj", roleLabel: "Performer" }],
        slotLinks: [{
          personSlug: "hidden-dj",
          displayLabel: "Hidden DJ",
          roleLabel: "DJ",
          startAt,
          endAt: startAt + 3_600_000,
        }],
      },
    );
    assert.equal(savedWithAssociations.preservedParticipantAssociationIds.length, 1);
    assert.equal(savedWithAssociations.preservedSlotAssociationIds.length, 1);
    assert.equal(savedWithAssociations.preservedWorldAssociationIds.length, 1);

    await t.withIdentity(identity).mutation(api.events.updateCommunityEvent, {
      currentSlug: created.slug,
      title: "Saved without changing the world",
      communitySlug: editableWhilePublic!.communitySlug,
      preservedCommunityProfileId: editableWhilePublic!.preservedCommunityProfileId,
      preservedParticipantAssociationIds: savedWithAssociations.preservedParticipantAssociationIds,
      preservedSlotAssociationIds: savedWithAssociations.preservedSlotAssociationIds,
      preservedWorldAssociationIds: savedWithAssociations.preservedWorldAssociationIds,
      startAt,
      timezone: "UTC",
      participantLinks: [{ personSlug: "hidden-dj", roleLabel: "Performer" }],
      slotLinks: [{
        personSlug: "hidden-dj",
        displayLabel: "Hidden DJ",
        roleLabel: "DJ",
        startAt,
        endAt: startAt + 3_600_000,
      }],
    });
    assert.equal(
      (await t.run((ctx) => ctx.db
        .query("eventWorlds")
        .withIndex("by_eventId", (query) => query.eq("eventId", created.eventId))
        .collect())).length,
      1,
    );

    await t.run(async (ctx) => {
      await ctx.db.patch(profileId, {
        displayName: "Private Host Rename",
        sortName: "private host rename",
        publicSurfacingState: "opted_out",
      });
      await ctx.db.patch(personId, { publicSurfacingState: "opted_out" });
      await ctx.db.patch(worldId, { publicationState: "draft_private" });
    });

    await t.withIdentity(identity).mutation(api.events.updateCommunityEvent, {
      currentSlug: created.slug,
      title: "Saved after associations became hidden",
      communitySlug: editableWhilePublic!.communitySlug,
      preservedCommunityProfileId: editableWhilePublic!.preservedCommunityProfileId,
      preservedParticipantAssociationIds: savedWithAssociations.preservedParticipantAssociationIds,
      preservedSlotAssociationIds: savedWithAssociations.preservedSlotAssociationIds,
      preservedWorldAssociationIds: savedWithAssociations.preservedWorldAssociationIds,
      worldSlug: "hidden-club",
      startAt,
      timezone: "UTC",
      participantLinks: [{ personSlug: "hidden-dj", roleLabel: "Performer" }],
      slotLinks: [{
        personSlug: "hidden-dj",
        displayLabel: "Hidden DJ",
        roleLabel: "DJ",
        startAt,
        endAt: startAt + 3_600_000,
      }],
    });

    const publicEvent = await t.query(api.events.getPublicBySlug, { slug: created.slug });
    assert.deepEqual(publicEvent?.worlds, []);
    assert.deepEqual(publicEvent?.participants, []);
    assert.equal(publicEvent?.slots[0]?.performer, undefined);
    assert.equal(publicEvent?.communitySlug, undefined);
    assert.equal(
      (await t.withIdentity(identity).query(api.events.listManagedEvents, {}))[0]?.eventId,
      created.eventId,
    );
    assert.deepEqual(
      await t.withIdentity(identity).query(api.events.listManagedCommunities, {}),
      [],
    );

    const editable = await t.withIdentity(identity).query(api.events.getEditableBySlug, {
      slug: created.slug,
    });
    assert.deepEqual(editable?.worlds, []);
    assert.deepEqual(editable?.participants, []);
    assert.equal(editable?.slots[0]?.performer, undefined);
    assert.equal(editable?.communitySlug, "faceless");
    assert.equal(editable?.communityName, "Private Host Rename");
    assert.equal(editable?.preservedCommunityProfileId, profileId);
    assert.equal(editable?.preservedParticipantAssociationIds.length, 1);
    assert.equal(editable?.preservedSlotAssociationIds.length, 1);
    assert.equal(editable?.preservedWorldAssociationIds.length, 1);

    const hiddenCommunityWorldContext = await t.run((ctx) =>
      getPublicWorldEventContext(ctx.db, worldId, NOW),
    );
    assert.equal(
      [...hiddenCommunityWorldContext.upcoming, ...hiddenCommunityWorldContext.recent]
        .find((event) => event.slug === created.slug)
        ?.communitySlug,
      undefined,
    );

    const shiftedStartAt = startAt + 60_000;
    await t.withIdentity(identity).mutation(api.events.updateCommunityEvent, {
      currentSlug: created.slug,
      title: "Updated hidden association event",
      published: false,
      communitySlug: editableWhilePublic!.communitySlug,
      preservedCommunityProfileId: editableWhilePublic!.preservedCommunityProfileId,
      preservedParticipantAssociationIds: editable!.preservedParticipantAssociationIds,
      preservedSlotAssociationIds: editable!.preservedSlotAssociationIds,
      preservedWorldAssociationIds: editable!.preservedWorldAssociationIds,
      startAt: shiftedStartAt,
      timezone: "UTC",
      participantLinks: [],
      slotLinks: [{
        displayLabel: "Hidden DJ",
        roleLabel: "DJ",
        startAt: shiftedStartAt,
        endAt: shiftedStartAt + 3_600_000,
      }],
    });

    const stored = await t.run(async (ctx) => ({
      event: await ctx.db.get(created.eventId),
      worlds: await ctx.db
        .query("eventWorlds")
        .withIndex("by_eventId", (query) => query.eq("eventId", created.eventId))
        .collect(),
      participants: await ctx.db
        .query("eventParticipants")
        .withIndex("by_eventId", (query) => query.eq("eventId", created.eventId))
        .collect(),
      slots: await ctx.db
        .query("eventSlots")
        .withIndex("by_eventId", (query) => query.eq("eventId", created.eventId))
        .collect(),
    }));
    assert.equal(stored.event?.title, "Updated hidden association event");
    assert.equal(stored.event?.publicationState, "draft_private");
    assert.equal(stored.event?.communityProfileId, profileId);
    assert.equal(stored.event?.communityName, "The Faceless");
    assert.equal(stored.worlds[0]?.worldId, worldId);
    assert.equal(stored.worlds[0]?.eventStartAt, shiftedStartAt);
    assert.equal(stored.participants[0]?.personProfileId, personId);
    assert.equal(stored.participants[0]?.eventStartAt, shiftedStartAt);
    assert.equal(stored.slots[0]?.personProfileId, personId);
    assert.equal(stored.slots[0]?.startAt, shiftedStartAt);
    assert.equal(stored.slots[0]?._id, editable!.preservedSlotAssociationIds[0]);

    await t.withIdentity(identity).mutation(api.events.updateCommunityEvent, {
      currentSlug: created.slug,
      title: "Updated hidden association event twice",
      published: false,
      preservedCommunityProfileId: editable!.preservedCommunityProfileId,
      preservedParticipantAssociationIds: editable!.preservedParticipantAssociationIds,
      preservedSlotAssociationIds: editable!.preservedSlotAssociationIds,
      preservedWorldAssociationIds: editable!.preservedWorldAssociationIds,
      startAt: shiftedStartAt,
      timezone: "UTC",
      participantLinks: [],
      slotLinks: [{
        displayLabel: "Hidden DJ",
        roleLabel: "DJ",
        startAt: shiftedStartAt,
        endAt: shiftedStartAt + 3_600_000,
      }],
    });
    const repeatedSaveSlot = await t.run((ctx) => ctx.db
      .query("eventSlots")
      .withIndex("by_eventId", (query) => query.eq("eventId", created.eventId))
      .first());
    assert.equal(repeatedSaveSlot?._id, editable!.preservedSlotAssociationIds[0]);
    assert.equal(repeatedSaveSlot?.personProfileId, personId);

    await t.run((ctx) => ctx.db.patch(profileId, { publicSurfacingState: "opted_out" }));

    await assert.rejects(
      t.withIdentity(identity).mutation(api.events.updateCommunityEvent, {
        currentSlug: created.slug,
        title: "Updated hidden association event",
        published: true,
        startAt: shiftedStartAt,
        timezone: "UTC",
        participantLinks: [],
        slotLinks: [{
          displayLabel: "Hidden DJ",
          roleLabel: "DJ",
          startAt: shiftedStartAt,
          endAt: shiftedStartAt + 3_600_000,
        }],
      }),
      /event community must be public/i,
    );
  });

  it("counts preserved hidden participants against the event cap", async () => {
    const t = convexTest({ schema, modules });
    const { identity } = await seedOwnedCommunity(t);
    const startAt = NOW + 3_600_000;
    const profiles = await t.run(async (ctx) => Promise.all(
      Array.from({ length: 81 }, (_, index) => ctx.db.insert("profiles", {
        profileType: "person",
        slug: `cap-dj-${index}`,
        displayName: `Cap DJ ${index}`,
        sortName: `cap dj ${index}`,
        aliases: [],
        tags: [],
        claimState: "unclaimed",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "community",
        person: { roleTags: ["DJ"] },
        updatedAt: NOW,
      })),
    ));
    const participantLinks = profiles.slice(0, 80).map((_, index) => ({
      personSlug: `cap-dj-${index}`,
      roleLabel: "DJ",
    }));
    const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Participant cap event",
      communitySlug: "faceless",
      startAt,
      participantLinks,
    });

    await t.run((ctx) => ctx.db.patch(profiles[0]!, { publicSurfacingState: "opted_out" }));

    await assert.rejects(
      t.withIdentity(identity).mutation(api.events.updateCommunityEvent, {
        currentSlug: created.slug,
        title: "Participant cap event",
        communitySlug: "faceless",
        startAt,
        participantLinks: profiles.slice(1).map((_, index) => ({
          personSlug: `cap-dj-${index + 1}`,
          roleLabel: "DJ",
        })),
      }),
      /at most 80 unique profiles/i,
    );

    const stored = await t.run((ctx) => ctx.db
      .query("eventParticipants")
      .withIndex("by_eventId", (query) => query.eq("eventId", created.eventId))
      .collect());
    assert.equal(stored.length, 80);
    assert.equal(stored.some((row) => row.personProfileId === profiles[0]), true);
  });

  it("keeps a published event online when an atomic unpublish-and-save fails", async () => {
    const t = convexTest({ schema, modules });
    const { identity } = await seedOwnedCommunity(t);
    const startAt = NOW + 86_400_000;
    const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Atomic event",
      communitySlug: "faceless",
      startAt,
    });
    await t.withIdentity(identity).mutation(api.events.setCommunityEventPublished, {
      currentSlug: created.slug,
      published: true,
    });

    await assert.rejects(
      t.withIdentity(identity).mutation(api.events.updateCommunityEvent, {
        currentSlug: created.slug,
        published: false,
        title: "Broken draft edit",
        communitySlug: "faceless",
        startAt,
        participantLinks: [{ personSlug: "missing-performer" }],
      }),
      /person profile/i,
    );
    assert.equal(
      (await t.query(api.events.getPublicBySlug, { slug: created.slug }))?.title,
      "Atomic event",
    );

    await t.withIdentity(identity).mutation(api.events.updateCommunityEvent, {
      currentSlug: created.slug,
      published: false,
      title: "Saved private draft",
      communitySlug: "faceless",
      startAt,
    });
    assert.equal(await t.query(api.events.getPublicBySlug, { slug: created.slug }), null);
    assert.equal(
      (await t.withIdentity(identity).query(api.events.getEditableBySlug, { slug: created.slug }))
        ?.title,
      "Saved private draft",
    );
  });

  it("refuses an authenticated user without current community authority", async () => {
    const t = convexTest({ schema, modules });
    const { identity: ownerIdentity } = await seedOwnedCommunity(t);
    const { identity } = await seedUser(t, "Unrelated User");

    const owned = await t.withIdentity(ownerIdentity).mutation(api.events.createCommunityEvent, {
      title: "Owner Event",
      communitySlug: "faceless",
      startAt: NOW + 86_400_000,
    });

    await assert.rejects(
      t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
        title: "Impersonated Event",
        communitySlug: "faceless",
        startAt: NOW + 86_400_000,
      }),
      /do not have permission to create events for this community/,
    );
    assert.equal(
      await t.withIdentity(identity).query(api.events.getEditableBySlug, {
        slug: owned.slug,
      }),
      null,
    );
    await assert.rejects(
      t.withIdentity(identity).query(api.events.listEventAudit, {
        currentSlug: owned.slug,
      }),
      /do not have permission/i,
    );
  });

  it("lets active manage_events staff create a draft and refuses them after revocation", async () => {
    const t = convexTest({ schema, modules });
    const { profileId } = await seedOwnedCommunity(t);
    const { identity } = await seedUser(t, "Event Staff");
    const authorityId = await t.run((ctx) =>
      ctx.db.insert("communityAuthorities", {
        communityProfileId: profileId,
        subjectTokenIdentifier: identity.tokenIdentifier,
        subject: {
          tokenIdentifier: identity.tokenIdentifier,
          issuer: identity.issuer,
          subject: identity.subject,
        },
        roleKey: "event_staff",
        roleLabel: "Event staff",
        capabilities: ["manage_events"],
        state: "active",
        grantedAt: NOW,
        updatedAt: NOW,
      }),
    );
    assert.deepEqual(
      (await t.withIdentity(identity).query(api.events.listManagedCommunities, {})).map(
        (community) => community.slug,
      ),
      ["faceless"],
    );
    const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Staff Programmed Night",
      communitySlug: "faceless",
      startAt: NOW + 86_400_000,
    });
    assert.equal(
      (await t.run((ctx) => ctx.db.get(created.eventId)))?.publicationState,
      "draft_private",
    );
    assert.equal(
      (await t.withIdentity(identity).query(api.events.listManagedEvents, {}))[0]?.eventId,
      created.eventId,
    );

    await t.run((ctx) =>
      ctx.db.patch(authorityId, { state: "revoked", revokedAt: NOW + 1, updatedAt: NOW + 1 }),
    );
    assert.deepEqual(
      await t.withIdentity(identity).query(api.events.listManagedCommunities, {}),
      [],
    );
    assert.deepEqual(
      await t.withIdentity(identity).query(api.events.listManagedEvents, {}),
      [],
    );
    await assert.rejects(
      t.withIdentity(identity).mutation(api.events.setCommunityEventPublished, {
        currentSlug: created.slug,
        published: true,
      }),
      /do not have permission/i,
    );
  });

  it("does not preserve submitter authority on a community-linked event", async () => {
    const t = convexTest({ schema, modules });
    const { profileId } = await seedOwnedCommunity(t);
    const { identity, userId } = await seedUser(t, "Former Submitter");
    const eventId = await t.run((ctx) =>
      ctx.db.insert("events", {
        slug: "former-submitter-event",
        title: "Former Submitter Event",
        sortTitle: "former submitter event",
        startAt: NOW + 86_400_000,
        communityProfileId: profileId,
        communityName: "The Faceless",
        sourceType: "community",
        sourceLabel: "Community submitted",
        submitter: {
          tokenIdentifier: `test|${userId}`,
          issuer: "test",
          subject: identity.subject,
        },
        eventStatus: "scheduled",
        publicationState: "published",
        publishedAt: NOW,
        updatedAt: NOW,
      }),
    );

    await assert.rejects(
      t.withIdentity(identity).mutation(api.events.updateCommunityEvent, {
        currentSlug: "former-submitter-event",
        title: "Changed by Former Submitter",
        communitySlug: "faceless",
        startAt: NOW + 86_400_000,
      }),
      /do not have permission to update this event/,
    );
    const event = await t.run((ctx) => ctx.db.get(eventId));
    assert.equal(event?.title, "Former Submitter Event");
  });

  it("keeps an in-progress event in the public upcoming query", async () => {
    const t = convexTest({ schema, modules });
    const { userId } = await seedOwnedCommunity(t);
    const created = await t.mutation(internal.events.createCommunityEventForApiOwner, {
      actorKind: "personal_api_token",
      ownerUserId: userId,
      title: "Faceless In Progress",
      communitySlug: "faceless",
      startAt: NOW - 3_600_000,
      endAt: NOW + 3_600_000,
      timezone: "UTC",
      slotLinks: [
        {
          displayLabel: "Finished DJ",
          startAt: NOW - 3_600_000,
          endAt: NOW - 60_000,
        },
        {
          displayLabel: "Current DJ",
          startAt: NOW,
          endAt: NOW + 3_600_000,
        },
      ],
    });

    const upcoming = await t.query(api.events.listPublicUpcoming, { now: NOW, limit: 8 });
    assert.equal(upcoming[0]?.slug, created.slug);
    assert.deepEqual(upcoming[0]?.nextSlots.map((slot) => slot.displayLabel), ["Current DJ"]);
  });

  it("lets the durable community owner edit and manage media from a normal session", async () => {
    const t = convexTest({ schema, modules });
    const { identity, userId } = await seedOwnedCommunity(t);
    const created = await t.mutation(internal.events.createCommunityEventForApiOwner, {
      actorKind: "personal_api_token",
      ownerUserId: userId,
      title: "Faceless Friday",
      communitySlug: "faceless",
      startAt: NOW + 86_400_000,
      summary: "Created through the public API.",
    });

    await t.withIdentity(identity).mutation(api.events.updateCommunityEvent, {
      currentSlug: created.slug,
      title: "Faceless Friday",
      communitySlug: "faceless",
      startAt: NOW + 86_400_000,
      summary: "Edited through the normal web session.",
    });
    const media = await t.withIdentity(identity).mutation(api.events.configureVrcdnOutput, {
      currentSlug: created.slug,
      key: "main",
      label: "Main output",
    });

    assert.equal(media.state, "draft");
    const stored = await t.run(async (ctx) => ctx.db.get(created.eventId));
    assert.equal(stored?.summary, "Edited through the normal web session.");
  });

  it("preserves omitted values and clears explicit nullable fields and the world relation", async () => {
    const t = convexTest({ schema, modules });
    const { userId } = await seedOwnedCommunity(t);
    await t.run((ctx) =>
      ctx.db.insert("worlds", {
        slug: "faceless-club",
        displayName: "Faceless Club",
        sortName: "faceless club",
        tags: [],
        visibilityStatus: "public",
        platformCompatibility: ["pc"],
        media: [],
        creatorAttributions: [],
        outboundLinks: [],
        publicationState: "published",
        creationSource: "community",
        updatedAt: NOW,
      }),
    );
    const created = await t.mutation(internal.events.createCommunityEventForApiOwner, {
      actorKind: "personal_api_token",
      ownerUserId: userId,
      title: "Faceless Friday",
      communitySlug: "faceless",
      worldSlug: "faceless-club",
      startAt: NOW + 86_400_000,
      timezone: "UTC",
      summary: "Keep me until explicitly cleared.",
      notes: "Preserved when omitted.",
    });

    await t.mutation(internal.events.updateCommunityEventForApiOwner, {
      actorKind: "personal_api_token",
      ownerUserId: userId,
      currentSlug: created.slug,
      summary: null,
      timezone: null,
      worldSlug: null,
    });

    const result = await t.run(async (ctx) => {
      const event = await ctx.db.get(created.eventId);
      const worldLinks = await ctx.db
        .query("eventWorlds")
        .withIndex("by_eventId", (query) => query.eq("eventId", created.eventId))
        .collect();
      return { event, worldLinks };
    });
    assert.equal(result.event?.summary, undefined);
    assert.equal(result.event?.timezone, undefined);
    assert.equal(result.event?.notes, "Preserved when omitted.");
    assert.deepEqual(result.worldLinks, []);
  });

  it("does not clear the timezone while preserving existing event slots", async () => {
    const t = convexTest({ schema, modules });
    const { userId } = await seedOwnedCommunity(t);
    const startAt = NOW + 86_400_000;
    const created = await t.mutation(internal.events.createCommunityEventForApiOwner, {
      actorKind: "personal_api_token",
      ownerUserId: userId,
      title: "Faceless Friday",
      communitySlug: "faceless",
      startAt,
      timezone: "UTC",
      participantLinks: [],
      slotLinks: [
        {
          displayLabel: "Opening set",
          startAt,
          endAt: startAt + 3_600_000,
        },
      ],
    });

    for (const timezone of [null, "", "   "]) {
      await assert.rejects(
        t.mutation(internal.events.updateCommunityEventForApiOwner, {
          actorKind: "personal_api_token",
          ownerUserId: userId,
          currentSlug: created.slug,
          timezone,
        }),
        /Time zone cannot be cleared while event slots are preserved/,
      );
    }

    const stored = await t.run(async (ctx) => ctx.db.get(created.eventId));
    assert.equal(stored?.timezone, "UTC");
  });
});
