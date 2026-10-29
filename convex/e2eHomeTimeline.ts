import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireLocalDeployment } from "./_localDeployment";
function guard(secret: string, runId: string) {
  // Convex bundles set NODE_ENV=production even locally. The deployment-owned
  // cloud URL is the authoritative boundary; Next also refuses production builds.
  requireLocalDeployment();
  if (
    process.env.VERCEL_ENV === "production" ||
    process.env.VRDEX_ENABLE_E2E_HELPERS !== "true" ||
    !process.env.VRDEX_E2E_CONVEX_SECRET?.trim() ||
    secret !== process.env.VRDEX_E2E_CONVEX_SECRET.trim()
  )
    throw Error("Timeline fixture unavailable");
  if (!/^playwright-timeline-[a-z0-9-]{8,48}$/.test(runId))
    throw Error("Invalid fixture run ID");
}
const h = 3_600_000;
const titles = [
  "Soft Focus",
  "Afterimage",
  "Glasshouse Sessions",
  "ORBIT: Interstellar Bassline Orchestra",
  "Low Tide",
  "Signal Room",
  "Night Without End",
  "Day Gathering",
];
export const create = mutation({
  args: {
    secret: v.string(),
    runId: v.string(),
    startAt: v.number(),
    scenario: v.optional(
      v.union(
        v.literal("prefetch"),
        v.literal("detail"),
        v.literal("discovery"),
        v.literal("discovery-dense"),
        v.literal("discovery-sparse"),
        v.literal("timeline-visual"),
        v.literal("short-sets"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    guard(args.secret, args.runId);
    if (
      !Number.isSafeInteger(args.startAt) ||
      args.startAt < Date.UTC(2020, 0, 1) ||
      args.startAt > Date.UTC(2099, 0, 1)
    )
      throw Error("Invalid fixture start");
    for (let i = 0; i < 8; i++)
      if (
        await ctx.db
          .query("events")
          .withIndex("by_slug", (q) => q.eq("slug", `${args.runId}-${i}`))
          .first()
      )
        throw Error("Fixture run already exists");
    if (args.scenario?.startsWith("discovery")) {
      const profileIds: Id<"profiles">[] = [];
      const kinds = ["community", "person", "community2", "person2"];
      for (const [index, kind] of kinds.entries()) {
        const community = kind.startsWith("community");
        profileIds.push(
          await ctx.db.insert("profiles", {
            slug: `${args.runId}-${kind}`,
            displayName: [
              "Prism Collective",
              "Aurora",
              "Tidal Society",
              "Nori",
            ][index],
            sortName: kind,
            ...(community
              ? {
                  profileType: "community" as const,
                  community: { categoryTags: [] },
                }
              : {
                  profileType: "person" as const,
                  person: { roleTags: ["DJ"] },
                }),
            ...(community
              ? {
                  avatarImageUrl: `https://timeline-artwork.invalid/${args.runId}/prism.svg`,
                }
              : {}),
            genres: [
              {
                slug: "fixture-liquid",
                displayName: "Liquid DnB",
                source: "owner_selected",
                confidence: "high",
                explicit: true,
              },
            ],
            aliases: [],
            tags: [],
            claimState: "unclaimed",
            creationSource: "community",
            publicationState: "published",
            publicSurfacingState: "public",
            updatedAt: Date.now(),
            sourceAttribution: {
              submittedAt: Date.now(),
              submitter: {
                tokenIdentifier: `e2e:${args.runId}`,
                issuer: "vrdex:e2e",
                subject: args.runId,
              },
            },
          }),
        );
      }
      const eventIds: Id<"events">[] = [],
        slotIds: Id<"eventSlots">[] = [];
      for (let i = 0; i < (args.scenario === "discovery-sparse" ? 1 : 2); i++) {
        const startAt = args.startAt + (i === 0 ? 24 * 7 : 24 * 40) * h;
        const eventId = await ctx.db.insert("events", {
          slug: `${args.runId}-${i}`,
          title: i === 0 ? "ORBIT" : "Low Tide",
          sortTitle: i === 0 ? "orbit" : "low tide",
          posterImageUrl:
            i === 0
              ? "/api/e2e/fixture-assets/fixture-orbit-timeline-poster"
              : "/api/e2e/fixture-assets/fixture-low-tide-discovery-poster",
          communityProfileId: profileIds[i * 2],
          startAt,
          endAt: startAt + 4 * h,
          scheduleKind: "timed",
          eventStatus: "scheduled",
          publicationState: "published",
          sourceType: "community",
          sourceLabel: args.runId,
          updatedAt: Date.now(),
        });
        eventIds.push(eventId);
        slotIds.push(
          await ctx.db.insert("eventSlots", {
            eventId,
            position: 0,
            personProfileId: profileIds[i * 2 + 1],
            startAt,
            endAt: startAt + h,
            displayLabel: i === 0 ? "Aurora" : "Nori",
            roleLabel: "DJ",
            sourceType: "community",
            sourceLabel: args.runId,
            confidence: 1,
            reviewState: "confirmed",
            updatedAt: Date.now(),
          }),
        );
      }
      if (args.scenario === "discovery-dense") {
        const original = await ctx.db.get(profileIds[1]);
        if (!original || original.profileType !== "person")
          throw Error("Missing fixture performer");
        for (const [kind, name, type] of [
          [
            "community3",
            "The Society for Exceptionally Long Musical Journeys",
            "community",
          ],
          ["hidden", "SECRET PERFORMER", "person"],
          ["hidden-community", "SECRET CLUB", "community"],
          ["person3", "An Exceptionally Long Public Performer Name", "person"],
        ] as const) {
          const { _id, _creationTime, person, profileType, ...fields } =
            original;
          void _id;
          void _creationTime;
          void person;
          void profileType;
          profileIds.push(
            await ctx.db.insert("profiles", {
              ...fields,
              slug: `${args.runId}-${kind}`,
              displayName: name,
              sortName: kind,
              ...(type === "community"
                ? {
                    profileType: "community" as const,
                    community: { categoryTags: [] },
                  }
                : {
                    profileType: "person" as const,
                    person: { roleTags: ["DJ"] },
                  }),
              publicSurfacingState: kind.startsWith("hidden")
                ? "suppressed"
                : "public",
              genres: [
                ...(original.genres ?? []),
                {
                  slug: "fixture-deep",
                  displayName: "Deep House",
                  displayLabel: "Deep journeys",
                  source: "owner_selected",
                  confidence: "high",
                  explicit: true,
                },
              ],
            }),
          );
        }
        await ctx.db.patch(profileIds[1], {
          genres: [
            ...(original.genres ?? []),
            {
              slug: "fixture-deep",
              displayName: "Deep House",
              displayLabel: "Deep journeys",
              source: "owner_selected",
              confidence: "high",
              explicit: true,
            },
          ],
        });
        for (let i = 2; i < 246; i++) {
          const distant = i === 242;
          const startAt =
            args.startAt +
            (distant ? 120 * 24 * h : 5 * 24 * h + (i - 1) * 60_000);
          const id = await ctx.db.insert("events", {
            slug: `${args.runId}-${i}`,
            title: distant
              ? "Distant Horizons"
              : i === 245
                ? "Prism Return"
                : `Near-term ${i}`,
            sortTitle: `fixture ${i}`,
            communityProfileId:
              i === 244
                ? profileIds[6]
                : i === 242
                  ? profileIds[2]
                  : profileIds[0],
            startAt,
            endAt: startAt + h,
            scheduleKind: "timed",
            eventStatus: "scheduled",
            publicationState: i === 243 ? "draft_private" : "published",
            sourceType: "community",
            sourceLabel: args.runId,
            updatedAt: Date.now(),
          });
          eventIds.push(id);
          if (i === 2 || distant || i === 245)
            slotIds.push(
              await ctx.db.insert("eventSlots", {
                eventId: id,
                position: 0,
                personProfileId:
                  i === 2
                    ? profileIds[5]
                    : distant
                      ? profileIds[7]
                      : profileIds[1],
                startAt,
                endAt: startAt + h,
                displayLabel: "Fixture performer",
                roleLabel: "DJ",
                sourceType: "community",
                sourceLabel: args.runId,
                confidence: 1,
                reviewState: "confirmed",
                updatedAt: Date.now(),
              }),
            );
        }
      }
      return { runId: args.runId, eventIds, slotIds, profileIds };
    }
    const profiles: Id<"profiles">[] = [];
    for (const kind of args.scenario === "detail"
      ? (["community", "person", "hidden"] as const)
      : (["community", "person"] as const)) {
      const slug = `${args.runId}-${kind}`;
      if (
        await ctx.db
          .query("profiles")
          .withIndex("by_slug", (q) => q.eq("slug", slug))
          .first()
      )
        throw Error("Fixture run already exists");
      profiles.push(
        await ctx.db.insert("profiles", {
          slug,
          displayName:
            kind === "hidden"
              ? "SECRET PERSON"
              : kind === "person"
                ? "Aurora"
                : "Prism Collective",
          sortName: kind,
          ...(kind !== "community"
            ? { profileType: "person" as const, person: { roleTags: ["DJ"] } }
            : {
                profileType: "community" as const,
                community: { categoryTags: [] },
              }),
          ...(kind === "community"
            ? {
                avatarImageUrl: `https://timeline-artwork.invalid/${args.runId}/prism.svg`,
              }
            : {}),
          aliases: [],
          tags: [],
          claimState: "unclaimed",
          creationSource: "community",
          publicationState: "published",
          publicSurfacingState: kind === "hidden" ? "suppressed" : "public",
          updatedAt: Date.now(),
          sourceAttribution: {
            submittedAt: Date.now(),
            submitter: {
              tokenIdentifier: `e2e:${args.runId}`,
              issuer: "vrdex:e2e",
              subject: args.runId,
            },
          },
        }),
      );
    }
    const eventIds: Id<"events">[] = [],
      slotIds: Id<"eventSlots">[] = [];
    for (let i = 0; i < 8; i++) {
      const offset =
        args.scenario === "prefetch"
          ? i === 0
            ? -4
            : i === 1
              ? -2
              : 24 + i * 4
          : [-2, 2, -1, 0, 0.5, 1.5, 1, 0][i];
      const startAt = args.startAt + offset * h;
      const duration =
        args.scenario === "prefetch" && i < 2
          ? i === 0
            ? 3
            : 22
          : i === 0
            ? 2.5
            : 4;
      const id = await ctx.db.insert("events", {
        slug: `${args.runId}-${i}`,
        title: titles[i],
        sortTitle: titles[i].toLowerCase(),
        posterImageUrl: "/api/e2e/fixture-assets/fixture-orbit-timeline-poster",
        venueLabel: "Orbital Station",
        summary:
          "A night of deep rhythms beneath the orbital lights.\n\nHosted by Prism Collective, with sets from Aurora and Neon Harbor.",
        communityProfileId: i === 4 ? undefined : profiles[0],
        startAt: i === 7 ? undefined : startAt,
        endAt: i >= 6 ? undefined : startAt + duration * h,
        scheduleKind: i === 7 ? "date_only" : "timed",
        eventDate:
          i === 7
            ? new Date(args.startAt).toISOString().slice(0, 10)
            : undefined,
        eventStatus: "scheduled",
        publicationState: "published",
        sourceType: "community",
        sourceLabel: args.runId,
        updatedAt: Date.now(),
      });
      eventIds.push(id);
      if (i < 4)
        for (
          let j = 0;
          j < (args.scenario === "detail" && i === 3 ? 81 : 2);
          j++
        )
          slotIds.push(
            await ctx.db.insert("eventSlots", {
              eventId: id,
              position: j,
              personProfileId:
                j === 79
                  ? profiles[2]
                  : j > 1 && j < 80
                    ? undefined
                    : profiles[1],
              startAt:
                startAt +
                (args.scenario === "short-sets" && i === 3
                  ? j === 0
                    ? h
                    : 1.5 * h
                  : j > 1
                    ? j * 60000
                    : j * h),
              endAt:
                startAt +
                (args.scenario === "short-sets" && i === 3
                  ? j === 0
                    ? 1.5 * h
                    : 1.75 * h
                  : j > 1
                    ? (j + 1) * 60000
                    : (j + 1) * h),
              displayLabel:
                j === 80
                  ? "Later-page guest"
                  : j > 1
                    ? `Guest ${j + 1}`
                    : j === 0
                      ? "Aurora"
                      : "Neon Harbor",
              roleLabel: "DJ",
              sourceType: "community",
              sourceLabel: args.runId,
              confidence: 1,
              reviewState: "confirmed",
              updatedAt: Date.now(),
            }),
          );
    }
    if (args.scenario === "detail")
      for (let i = 0; i < 2; i++) {
        await ctx.db.insert("eventLineupEntries", {
          eventId: eventIds[3],
          clientKey: `${args.runId}-lineup-${i}`,
          position: 81 + i,
          performerLabel: i === 0 ? "Untimed Aurora" : "Manual guest",
          personProfileId: i === 0 ? profiles[1] : undefined,
          updatedAt: Date.now(),
        });
      }
    if (args.scenario === "timeline-visual") {
      const genres = [
        {
          slug: "fixture-visual-liquid",
          displayName: "Liquid DnB",
          source: "owner_selected" as const,
          confidence: "high" as const,
          explicit: true,
        },
        {
          slug: "fixture-visual-deep",
          displayName: "Deep House",
          source: "owner_selected" as const,
          confidence: "high" as const,
          explicit: true,
        },
      ];
      // Only the new DJ/club IDs become favorites. The eight original Schedule
      // rows retain their existing geometry and unfavorited emphasis.
      await ctx.db.patch(profiles[0], { genres });
      const source = await ctx.db.get(profiles[1]);
      if (!source || source.profileType !== "person")
        throw Error("Missing fixture performer");
      const { _id, _creationTime, person, profileType, ...fields } = source;
      void _id;
      void _creationTime;
      void person;
      void profileType;
      for (const [kind, displayName] of [
        ["community2", "Tidal Society"],
        ["person2", "Nori"],
        ["person3", "Iona"],
      ] as const) {
        profiles.push(
          await ctx.db.insert("profiles", {
            ...fields,
            slug: `${args.runId}-${kind}`,
            displayName,
            sortName: kind,
            genres,
            ...(kind === "community2"
              ? {
                  profileType: "community" as const,
                  community: { categoryTags: [] },
                  avatarImageUrl: `https://timeline-artwork.invalid/${args.runId}/prism.svg`,
                }
              : {
                  profileType: "person" as const,
                  person: { roleTags: ["DJ"] },
                }),
          }),
        );
      }
      for (const i of [8, 9]) {
        const startAt = args.startAt + (i === 8 ? 7 : 40) * 24 * h;
        const id = await ctx.db.insert("events", {
          slug: `${args.runId}-${i}`,
          title: i === 8 ? "ORBIT Discovery" : "Tidal Discovery",
          sortTitle: `discovery ${i}`,
          posterImageUrl:
            i === 8
              ? "/api/e2e/fixture-assets/fixture-orbit-timeline-poster"
              : "/api/e2e/fixture-assets/fixture-low-tide-discovery-poster",
          communityProfileId: i === 8 ? profiles[2] : profiles[0],
          startAt,
          endAt: startAt + 4 * h,
          scheduleKind: "timed",
          eventStatus: "scheduled",
          publicationState: "published",
          sourceType: "community",
          sourceLabel: args.runId,
          updatedAt: Date.now(),
        });
        eventIds.push(id);
        slotIds.push(
          await ctx.db.insert("eventSlots", {
            eventId: id,
            position: 0,
            personProfileId: i === 8 ? profiles[3] : profiles[4],
            startAt,
            endAt: startAt + h,
            displayLabel: i === 8 ? "Nori" : "Iona",
            roleLabel: "DJ",
            sourceType: "community",
            sourceLabel: args.runId,
            confidence: 1,
            reviewState: "confirmed",
            updatedAt: Date.now(),
          }),
        );
      }
    }
    return { runId: args.runId, eventIds, slotIds, profileIds: profiles };
  },
});
export const cleanup = mutation({
  args: { secret: v.string(), runId: v.string() },
  handler: async (ctx, args) => {
    guard(args.secret, args.runId);
    const count = { events: 0, profiles: 0, slots: 0 };
    let lineupEntries = 0;
    for (let i = 0; i < 246; i++) {
      const e = await ctx.db
        .query("events")
        .withIndex("by_slug", (q) => q.eq("slug", `${args.runId}-${i}`))
        .unique();
      if (!e) continue;
      if (e.sourceLabel !== args.runId)
        throw Error("Fixture ownership mismatch");
      const slots = await ctx.db
        .query("eventSlots")
        .withIndex("by_eventId", (q) => q.eq("eventId", e._id))
        .collect();
      for (const slot of slots) {
        if (slot.sourceLabel !== args.runId)
          throw Error("Fixture slot ownership mismatch");
        await ctx.db.delete(slot._id);
        count.slots++;
      }
      const lineup = await ctx.db
        .query("eventLineupEntries")
        .withIndex("by_eventId_position", (q) => q.eq("eventId", e._id))
        .collect();
      for (const row of lineup) {
        if (!row.clientKey.startsWith(`${args.runId}-lineup-`))
          throw Error("Fixture lineup ownership mismatch");
        await ctx.db.delete(row._id);
        lineupEntries++;
      }
      await ctx.db.delete(e._id);
      count.events++;
    }
    for (const kind of [
      "community",
      "person",
      "hidden",
      "community2",
      "person2",
      "community3",
      "hidden-community",
      "person3",
    ]) {
      const p = await ctx.db
        .query("profiles")
        .withIndex("by_slug", (q) => q.eq("slug", `${args.runId}-${kind}`))
        .unique();
      if (!p) continue;
      if (
        p.sourceAttribution?.submitter.tokenIdentifier !== `e2e:${args.runId}`
      )
        throw Error("Fixture ownership mismatch");
      await ctx.db.delete(p._id);
      count.profiles++;
    }
    return { ...count, ...(lineupEntries > 0 ? { lineupEntries } : {}) };
  },
});

export const changeState = mutation({
  args: {
    secret: v.string(),
    runId: v.string(),
    eventIndex: v.number(),
    state: v.union(
      v.literal("cancelled"),
      v.literal("hidden"),
      v.literal("recreate-slot"),
      v.literal("suppress-host"),
    ),
  },
  handler: async (ctx, args) => {
    guard(args.secret, args.runId);
    if (
      !Number.isInteger(args.eventIndex) ||
      args.eventIndex < 0 ||
      args.eventIndex > 7
    )
      throw Error("Invalid fixture event");
    const event = await ctx.db
      .query("events")
      .withIndex("by_slug", (q) =>
        q.eq("slug", `${args.runId}-${args.eventIndex}`),
      )
      .unique();
    if (!event || event.sourceLabel !== args.runId)
      throw Error("Fixture ownership mismatch");
    if (args.state === "suppress-host") {
      const host = event.communityProfileId
        ? await ctx.db.get(event.communityProfileId)
        : null;
      if (
        !host ||
        host.sourceAttribution?.submitter.tokenIdentifier !==
          `e2e:${args.runId}`
      )
        throw Error("Fixture host ownership mismatch");
      await ctx.db.patch(host._id, {
        publicSurfacingState: "suppressed",
        updatedAt: Date.now(),
      });
      return;
    }
    if (args.state === "recreate-slot") {
      const slot = await ctx.db
        .query("eventSlots")
        .withIndex("by_eventId", (q) => q.eq("eventId", event._id))
        .first();
      if (!slot || slot.sourceLabel !== args.runId)
        throw Error("Fixture slot ownership mismatch");
      const { _id, _creationTime, ...fields } = slot;
      void _creationTime;
      await ctx.db.delete(_id);
      await ctx.db.insert("eventSlots", fields);
      return;
    }
    await ctx.db.patch(
      event._id,
      args.state === "cancelled"
        ? { eventStatus: "cancelled", updatedAt: Date.now() }
        : { publicationState: "draft_private", updatedAt: Date.now() },
    );
  },
});
