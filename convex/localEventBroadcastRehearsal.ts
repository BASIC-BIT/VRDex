/** Internal, local-only historical fixtures. Never grants worker/publication authority. */
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type DatabaseReader,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireLocalDeployment } from "./_localDeployment";
import { getOrCreateEventMediaProgram } from "./events";

const args = { runId: v.string() };
const marker = (runId: string) => `local-broadcast-rehearsal:${runId}`;
function guard(runId: string) {
  requireLocalDeployment();
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(runId))
    throw Error("Invalid rehearsal runId.");
}
async function lookup(db: DatabaseReader, runId: string) {
  guard(runId);
  return db
    .query("localEventBroadcastRehearsals")
    .withIndex("by_runId", (q) => q.eq("runId", runId))
    .unique();
}
async function owned(db: DatabaseReader, runId: string) {
  const m = await lookup(db, runId);
  if (!m) throw Error("Rehearsal manifest missing.");
  const [community, event, program, user, owner] = await Promise.all([
    db.get(m.communityId),
    db.get(m.eventId),
    db.get(m.programId),
    db.get(m.userId),
    db.get(m.ownerId),
  ]);
  if (
    community?.publicSurfacingReason !== marker(runId) ||
    event?.notes !== marker(runId) ||
    event.communityProfileId !== m.communityId ||
    program?.eventId !== m.eventId ||
    user?.clerkUserId !== `user_rehearsal_${runId}` ||
    owner?.userId !== m.userId ||
    owner.profileId !== m.communityId
  )
    throw Error("Rehearsal ownership mismatch.");
  return m;
}
function publicManifest(m: Doc<"localEventBroadcastRehearsals">) {
  const subject = `user_rehearsal_${m.runId}`;
  return {
    runId: m.runId,
    communityId: m.communityId,
    eventId: m.eventId,
    programId: m.programId,
    slug: `rehearsal-event-${m.runId}`,
    actor: {
      subject,
      issuer: "https://local-rehearsal.invalid",
      tokenIdentifier: `https://local-rehearsal.invalid|${subject}`,
      emailVerified: true,
    },
  };
}
async function assertIsolation(
  db: DatabaseReader,
  m: Doc<"localEventBroadcastRehearsals">,
) {
  for (const [table, ids] of [
    ["eventMediaSources", m.sources.map((r) => r.id)],
    ["eventMediaSessions", m.sessions.map((r) => r.id)],
    ["eventMediaCommands", m.commands.map((r) => r.id)],
  ] as const) {
    const rows = await db.query(table).take(129);
    const expected = new Set<string>(ids);
    if (rows.length !== ids.length || rows.some((r) => !expected.has(r._id)))
      throw Error(
        "Migration requires isolated fixture state; unrelated broadcast rows exist.",
      );
  }
}
export const seed = internalMutation({
  args,
  handler: async ({ db }, { runId }) => {
    guard(runId);
    const prior = await lookup(db, runId);
    if (prior) return publicManifest(await owned(db, runId));
    for (const table of [
      "localEventBroadcastRehearsals",
      "eventMediaPrograms",
      "eventMediaSources",
      "eventMediaSessions",
      "eventMediaCommands",
      "eventMediaOutputs",
    ] as const) {
      if (await db.query(table).first())
        throw Error("Rehearsal requires fresh isolated broadcast state.");
    }
    const slug = `rehearsal-${runId}`;
    const eventSlug = `rehearsal-event-${runId}`;
    for (const name of ["removed-link", "hidden-link", "hidden-profile"]) {
      if (
        await db
          .query("profiles")
          .withIndex("by_slug", (q) => q.eq("slug", `${slug}-${name}`))
          .first()
      )
        throw Error("Rehearsal name has nonfixture ownership.");
    }
    if (
      (await db
        .query("profiles")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first()) ||
      (await db
        .query("events")
        .withIndex("by_slug", (q) => q.eq("slug", eventSlug))
        .first()) ||
      (await db
        .query("users")
        .withIndex("clerkUserId", (q) =>
          q.eq("clerkUserId", `user_rehearsal_${runId}`),
        )
        .first())
    )
      throw Error("Rehearsal name has nonfixture ownership.");
    const now = Date.now();
    const userId = await db.insert("users", {
      clerkUserId: `user_rehearsal_${runId}`,
      name: "Local rehearsal owner",
      emailVerificationTime: now,
    });
    const profileBase = {
      displayName: "Local rehearsal",
      sortName: "local rehearsal",
      aliases: [],
      tags: [],
      claimState: "claimed_verified" as const,
      publicationState: "published" as const,
      publicSurfacingState: "public" as const,
      publicSurfacingReason: marker(runId),
      creationSource: "self" as const,
      updatedAt: now,
    };
    const communityId = await db.insert("profiles", {
      ...profileBase,
      slug,
      profileType: "community",
      community: { categoryTags: [] },
    });
    const ownerId = await db.insert("profileOwners", {
      profileId: communityId,
      userId,
      roleKey: "owner",
      state: "active",
      grantedAt: now,
      updatedAt: now,
    });
    // Historical event has no short-link/search/dispatch effects. New sessions are scheduled only via events handlers.
    const eventId = await db.insert("events", {
      slug: eventSlug,
      title: "Local migration history",
      sortTitle: "local migration history",
      startAt: now + 600_000,
      sortAt: now + 600_000,
      scheduleKind: "timed",
      timezone: "UTC",
      communityProfileId: communityId,
      sourceType: "community",
      sourceLabel: "Local rehearsal",
      eventStatus: "scheduled",
      publicationState: "draft_private",
      notes: marker(runId),
      updatedAt: now,
    });
    const event = await db.get(eventId);
    if (!event) throw Error("Historical event missing.");
    const programId = await getOrCreateEventMediaProgram(db, event, now);
    const sources: Doc<"localEventBroadcastRehearsals">["sources"] = [];
    const sessions: Doc<"localEventBroadcastRehearsals">["sessions"] = [];
    const commands: Doc<"localEventBroadcastRehearsals">["commands"] = [];
    const profileIds: Id<"profiles">[] = [],
      slotIds: Id<"eventSlots">[] = [];
    for (const name of [
      "manual-one",
      "manual-ambiguous",
      "manual-observed",
      "manual-stale",
      "disabled",
      "removed-link",
      "hidden-link",
      "hidden-profile",
      "internal",
      "foreign",
    ] as const) {
      let projection: Pick<
        Doc<"eventMediaSources">,
        | "eventSlotId"
        | "sourceProfileId"
        | "profileProjection"
        | "projectionAvailable"
      > = {};
      if (["removed-link", "hidden-link", "hidden-profile"].includes(name)) {
        const profileId = await db.insert("profiles", {
          ...profileBase,
          slug: `${slug}-${name}`,
          profileType: "person",
          person: { roleTags: [] },
          publicationState:
            name === "hidden-profile" ? "draft_private" : "published",
          ...(name === "hidden-link"
            ? { fieldVisibility: { outboundLinks: "private" as const } }
            : {}),
          outboundLinks:
            name === "removed-link"
              ? []
              : [
                  {
                    type: "other",
                    label: "Stream",
                    source: "owner_authored",
                    url: "vrcdn:rehearsal_input",
                  },
                ],
        });
        profileIds.push(profileId);
        const slotId = await db.insert("eventSlots", {
          eventId,
          position: slotIds.length,
          startAt: now,
          personProfileId: profileId,
          selectedStreamId: "rehearsal_input",
          displayLabel: name,
          roleLabel: "DJ",
          sourceType: "manual",
          sourceLabel: "Local rehearsal",
          confidence: 1,
          reviewState: "confirmed",
          updatedAt: now,
        });
        slotIds.push(slotId);
        projection = {
          eventSlotId: slotId,
          sourceProfileId: profileId,
          profileProjection: true,
          projectionAvailable: true,
        };
      }
      const id = await db.insert("eventMediaSources", {
        programId,
        eventId,
        key: projection.eventSlotId ? `slot-${projection.eventSlotId}` : name,
        position: sources.length,
        type: name === "internal" ? "rtmp_source" : "vrcdn_link",
        purpose: "program",
        state: name === "disabled" ? "disabled" : "ready",
        label: name,
        publicUrl: "https://stream.vrcdn.live/live/rehearsal_input.live.ts",
        ...(name === "manual-ambiguous" ||
        name === "manual-observed" ||
        name === "manual-stale"
          ? { revision: 2 }
          : {}),
        ...projection,
        notes: marker(runId),
        createdAt: now,
        updatedAt: now,
      });
      sources.push({ case: name, id });
    }
    // An unavailable historical foreign program reference, never an allocatable session.
    const foreignProgramId = await db.insert("eventMediaPrograms", {
      eventId,
      state: "draft",
      publicLinks: [],
      directFallbackLinks: [],
      createdAt: now,
      updatedAt: now,
    });
    const foreign = sources.find((r) => r.case === "foreign");
    if (!foreign) throw Error("Foreign history missing.");
    await db.patch(foreign.id, { programId: foreignProgramId });
    await db.delete(foreignProgramId);
    for (const name of [
      "automatic",
      "hold",
      "manual-one",
      "manual-ambiguous",
      "manual-observed",
      "manual-stale",
      "disabled",
      "removed-link",
      "hidden-link",
      "hidden-profile",
      "explicit",
      "internal",
      "missing",
      "foreign",
    ]) {
      const source = sources.find((r) => r.case === name);
      const id = await db.insert("eventMediaSessions", {
        programId,
        eventId,
        status: "ended",
        broadcastMode:
          name === "automatic" || name === "explicit"
            ? "automatic"
            : name === "hold"
              ? "hold"
              : "manual",
        ...(source ? { currentSourceId: source.id } : {}),
        ...(name === "manual-observed"
          ? { observedSourceRevision: 2 }
          : name === "manual-stale"
            ? { observedSourceRevision: 1 }
            : {}),
        ...(name === "explicit"
          ? {
              committedIntent: { kind: "automatic" as const },
              intentSequence: 99,
            }
          : {}),
        lastAcknowledgedSequence: 7,
        createdAt: now,
        updatedAt: now,
      });
      sessions.push({ case: name, id });
    }
    for (const commandType of [
      "switch_source",
      "switch_hold",
      "set_automatic_mode",
      "preview_source",
    ] as const) {
      for (const status of ["queued", "claimed"] as const) {
        const id = await db.insert("eventMediaCommands", {
          programId,
          eventId,
          sessionId: sessions[0].id,
          commandType,
          status,
          sequence: commands.length + 1,
          actorSurface: "worker",
          publicFallbackLinks: [],
          createdAt: now,
          updatedAt: now,
        });
        commands.push({ case: `pending-${commandType}-${status}`, id });
      }
    }
    for (const status of ["succeeded", "cancelled"] as const) {
      const id = await db.insert("eventMediaCommands", {
        programId,
        eventId,
        sessionId: sessions[0].id,
        commandType: "switch_source",
        status,
        sequence: 77,
        observedState: "live",
        actorSurface: "worker",
        publicFallbackLinks: [],
        createdAt: now,
        updatedAt: now,
      });
      commands.push({
        case: status === "succeeded" ? "completed" : "cancelled",
        id,
      });
    }
    await db.patch(sessions[0].id, { pendingControlCommandId: commands[0].id });
    const id = await db.insert("localEventBroadcastRehearsals", {
      runId,
      userId,
      ownerId,
      communityId,
      eventId,
      programId,
      profileIds,
      slotIds,
      sources,
      sessions,
      commands,
    });
    const manifest = await db.get(id);
    if (!manifest) throw Error("Manifest missing.");
    return publicManifest(manifest);
  },
});

const scenario = v.union(
  ...(
    [
      "assert-migration-isolation",
      "scheduled",
      "starting",
      "live",
      "hold",
      "fallback",
      "stopping",
      "dispatch-unconfirmed",
      "task-queued",
      "task-running",
      "task-starting",
      "task-stopping",
      "task-failed",
      "task-legacy",
      "task-confirmed",
      "ended-baseline",
      "expire-lease",
      "expire-receipt",
      "disable-destination",
      "revoke-destination",
    ] as const
  ).map((c) => v.literal(c)),
);
export const setScenario = internalMutation({
  args: { ...args, case: scenario },
  handler: async ({ db }, { runId, case: name }) => {
    const m = await owned(db, runId);
    if (name === "assert-migration-isolation") {
      await assertIsolation(db, m);
      return null;
    }
    if (
      [
        "scheduled",
        "starting",
        "live",
        "hold",
        "fallback",
        "stopping",
        "dispatch-unconfirmed",
        "task-queued",
        "task-running",
        "task-starting",
        "task-stopping",
        "task-failed",
        "task-legacy",
        "task-confirmed",
        "ended-baseline",
      ].includes(name)
    ) {
      const id = m.sessions[0].id;
      const row = await db.get(id);
      if (row?.eventId !== m.eventId || row.programId !== m.programId)
        throw Error("Historical session ownership mismatch.");
      const status =
        name === "scheduled" ||
        name === "starting" ||
        name === "live" ||
        name === "hold" ||
        name === "fallback" ||
        name === "stopping"
          ? name
          : "ended";
      await db.patch(id, {
        status,
        dispatchId:
          name === "dispatch-unconfirmed" || name === "task-confirmed"
            ? "local-rehearsal-dispatch"
            : undefined,
        workerTaskId: [
          "task-queued",
          "task-failed",
          "task-legacy",
          "task-confirmed",
        ].includes(name)
          ? "local-rehearsal-task"
          : undefined,
        workerTaskStatus:
          name === "task-queued"
            ? "queued"
            : name === "task-running"
              ? "running"
              : name === "task-starting"
                ? "starting"
                : name === "task-stopping"
                  ? "stopping"
                  : name === "task-failed" || name === "task-confirmed"
                    ? "failed"
                    : undefined,
        dispatchStopConfirmedAt: name === "task-confirmed" ? 1 : undefined,
      });
      await db.patch(m.programId, { activeSessionId: undefined });
      return null;
    }
    const program = await db.get(m.programId);
    const session = program?.activeSessionId
      ? await db.get(program.activeSessionId)
      : null;
    if (
      !session ||
      session.eventId !== m.eventId ||
      session.programId !== m.programId ||
      m.sessions.some((r) => r.id === session._id)
    )
      throw Error("Scenario requires this fixture’s real scheduled session.");
    if (name === "expire-lease")
      await db.patch(session._id, { leaseExpiresAt: 0 });
    else if (name === "expire-receipt") {
      const command = session.pendingControlCommandId
        ? await db.get(session.pendingControlCommandId)
        : null;
      if (
        !command ||
        command.sessionId !== session._id ||
        command.eventId !== m.eventId ||
        command.programId !== m.programId ||
        !command.controlPhase
      )
        throw Error("No owned preparation receipt.");
      await db.patch(command._id, { preparationExpiresAt: 0 });
    } else {
      const output = session.outputId ? await db.get(session.outputId) : null;
      if (
        !output ||
        output.eventId !== m.eventId ||
        output.programId !== m.programId ||
        output.key !== "rehearsal"
      )
        throw Error("No owned rehearsal output.");
      if (name === "disable-destination")
        await db.patch(output._id, { state: "disabled" });
      else if (name === "revoke-destination") {
        if (!output.credential) throw Error("No credential grant.");
        await db.patch(output._id, {
          credential: {
            ...output.credential,
            secretRef: "local-rehearsal/revoked",
          },
        });
      }
    }
    return null;
  },
});

export const inspect = internalQuery({
  args,
  handler: async ({ db }, { runId }) => {
    const m = await owned(db, runId);
    const sources = await Promise.all(
      m.sources.map(async (entry) => {
        const row = await db.get(entry.id);
        if (!row || row.eventId !== m.eventId || row.notes !== marker(runId))
          throw Error("Source ownership mismatch.");
        return {
          key: entry.case,
          id: row._id,
          input: row.input ?? null,
          revision: row.revision ?? null,
          state: row.state,
          projectionAvailable: row.projectionAvailable ?? null,
        };
      }),
    );
    const rows = await db
      .query("eventMediaSessions")
      .withIndex("by_eventId_status", (q) => q.eq("eventId", m.eventId))
      .take(33);
    if (rows.length > 32 || rows.some((r) => r.programId !== m.programId))
      throw Error("Session ownership/bound exceeded.");
    const sessions = rows.map((row) => ({
      case:
        m.sessions.find((e) => e.id === row._id)?.case ?? "scheduled-current",
      id: row._id,
      status: row.status,
      committedIntent: row.committedIntent ?? null,
      intentSequence: row.intentSequence ?? null,
      pendingControlCommandId: row.pendingControlCommandId ?? null,
      epoch: row.epoch ?? null,
      runtimeDeadlineAt: row.runtimeDeadlineAt ?? null,
      observedOutputMs: row.observedOutputMs ?? null,
      allocation: row.allocation ?? null,
      mediaSettings: row.mediaSettings ?? null,
      destinationProfiles: row.destinationProfiles ?? null,
    }));
    const commandRows = await db
      .query("eventMediaCommands")
      .withIndex("by_eventId_createdAt", (q) => q.eq("eventId", m.eventId))
      .take(97);
    if (
      commandRows.length > 96 ||
      commandRows.some((r) => r.programId !== m.programId)
    )
      throw Error("Command ownership/bound exceeded.");
    const commands = commandRows.map((row) => ({
      case: m.commands.find((e) => e.id === row._id)?.case ?? "current",
      id: row._id,
      sessionId: row.sessionId ?? null,
      commandType: row.commandType,
      status: row.status,
      sequence: row.sequence ?? null,
      controlOutcome: row.controlOutcome ?? null,
      controlPhase: row.controlPhase ?? null,
      controlTarget: row.controlTarget ?? null,
      preparationExpiresAt: row.preparationExpiresAt ?? null,
      observedState: row.observedState ?? null,
      completedAt: row.completedAt ?? null,
      updatedAt: row.updatedAt,
    }));
    const profiles = await Promise.all(
      m.profileIds.map(async (id) => {
        const p = await db.get(id);
        if (p?.publicSurfacingReason !== marker(runId))
          throw Error("Profile ownership mismatch.");
        return {
          id,
          publicationState: p.publicationState,
          fieldVisibility: p.fieldVisibility ?? null,
          outboundLinks: p.outboundLinks ?? [],
        };
      }),
    );
    return { sources, sessions, commands, profiles };
  },
});

export const cleanup = internalMutation({
  args,
  handler: async ({ db }, { runId }) => {
    const found = await lookup(db, runId);
    if (!found) return { deleted: 0 };
    const m = await owned(db, runId);
    let deleted = 0;
    // Runtime handlers create only these event-scoped rows. Every read is bounded,
    // every delete checks the fixture's immutable event/program ownership.
    for (const table of [
      "eventMediaAuditEvents",
      "eventMediaControlRequests",
      "eventMediaCommands",
      "eventMediaSessions",
      "eventMediaOutputs",
    ] as const) {
      const rows = await db.query(table).take(257);
      if (rows.length > 256) throw Error("Cleanup inventory bound exceeded.");
      for (const row of rows)
        if (row.eventId === m.eventId) {
          if ("programId" in row && row.programId !== m.programId)
            throw Error("Cleanup ownership mismatch.");
          await db.delete(row._id);
          deleted++;
        }
    }
    for (const entry of m.sources) {
      const row = await db.get(entry.id);
      if (row) {
        if (row.eventId !== m.eventId || row.notes !== marker(runId))
          throw Error("Source ownership mismatch.");
        await db.delete(entry.id);
        deleted++;
      }
    }
    for (const id of m.slotIds) {
      const row = await db.get(id);
      if (row) {
        if (row.eventId !== m.eventId) throw Error("Slot ownership mismatch.");
        await db.delete(id);
        deleted++;
      }
    }
    for (const id of m.profileIds) {
      const row = await db.get(id);
      if (row) {
        if (row.publicSurfacingReason !== marker(runId))
          throw Error("Profile ownership mismatch.");
        await db.delete(id);
        deleted++;
      }
    }
    for (const id of [
      m.programId,
      m.eventId,
      m.ownerId,
      m.communityId,
      m.userId,
      m._id,
    ]) {
      await db.delete(id);
      deleted++;
    }
    return { deleted };
  },
});
