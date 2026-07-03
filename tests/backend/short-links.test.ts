import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "../../convex/_generated/server";
import {
  canReserveShortLinkForTarget,
  checkShortLinkCodeAvailability,
  ensureShortLinkForTarget,
  findAvailableShortLinkCode,
  generateShortLinkCode,
  normalizeShortLinkCodeInput,
  resolvePublicShortLinkTarget,
  SHORT_LINK_CODE_LENGTH,
  SHORT_LINK_CODE_PATTERN,
  toShortLinkCode,
  validateShortLinkCode,
} from "../../convex/_shortLinks";

type TestTable =
  | "shortLinks"
  | "profiles"
  | "worlds"
  | "events"
  | "eventWorlds"
  | "eventParticipants"
  | "eventSlots"
  | "eventMediaPrograms"
  | "eventMediaOutputs"
  | "profileOwners"
  | "communityAuthorities";

type TestDoc = Record<string, unknown> & { _id: string };

function createShortLinkDb(initial: Partial<Record<TestTable, TestDoc[]>>) {
  const tables = new Map<TestTable, TestDoc[]>();
  const inserted: Array<{ table: string; document: Record<string, unknown> }> = [];

  for (const table of [
    "shortLinks",
    "profiles",
    "worlds",
    "events",
    "eventWorlds",
    "eventParticipants",
    "eventSlots",
    "eventMediaPrograms",
    "eventMediaOutputs",
    "profileOwners",
    "communityAuthorities",
  ] as const) {
    tables.set(table, [...(initial[table] ?? [])]);
  }

  function rowsFor(table: string, filters: Record<string, unknown>) {
    const rows = tables.get(table as TestTable) ?? [];

    return rows.filter((row) =>
      Object.entries(filters).every(([field, value]) => row[field] === value),
    );
  }

  const db = {
    async get(id: string) {
      for (const rows of tables.values()) {
        const match = rows.find((row) => row._id === id);

        if (match !== undefined) {
          return match;
        }
      }

      return null;
    },
    query(table: string) {
      return {
        withIndex(_index: string, builder: (query: unknown) => unknown) {
          const filters: Record<string, unknown> = {};
          const query = {
            eq(field: string, value: unknown) {
              filters[field] = value;
              return query;
            },
            gte(field: string, value: unknown) {
              filters[field] = value;
              return query;
            },
          };

          builder(query);

          const indexedQuery = {
            filter(builder: (query: unknown) => unknown) {
              const filterQuery = {
                field(field: string) {
                  return field;
                },
                eq(field: string, value: unknown) {
                  filters[field] = value;
                  return filterQuery;
                },
              };

              builder(filterQuery);
              return indexedQuery;
            },
            order() {
              return indexedQuery;
            },
            async unique() {
              const matches = rowsFor(table, filters);

              if (matches.length > 1) {
                throw new Error("Expected unique query result.");
              }

              return matches[0] ?? null;
            },
            async first() {
              return rowsFor(table, filters)[0] ?? null;
            },
            async take(limit: number) {
              return rowsFor(table, filters).slice(0, limit);
            },
            async collect() {
              return rowsFor(table, filters);
            },
          };

          return indexedQuery;
        },
        async collect() {
          return tables.get(table as TestTable) ?? [];
        },
      };
    },
    async insert(table: string, document: Record<string, unknown>) {
      const rows = tables.get(table as TestTable);

      if (rows === undefined) {
        throw new Error(`Unknown test table ${table}.`);
      }

      const id = `${table}-new-${rows.length + 1}`;
      rows.push({ _id: id, ...document });
      inserted.push({ table, document });
      return id;
    },
  };

  return {
    db: db as unknown as DatabaseReader & DatabaseWriter,
    inserted,
  };
}

describe("short link code helpers", () => {
  it("normalizes and validates generated short link codes", () => {
    assert.equal(normalizeShortLinkCodeInput(" AbC123 "), "abc123");
    assert.deepEqual(validateShortLinkCode("abc23"), { ok: true, code: "abc23" });
    assert.deepEqual(toShortLinkCode(" ABC23 "), { ok: true, code: "abc23" });
    assert.deepEqual(validateShortLinkCode("ABC23"), {
      ok: false,
      reason: "invalid_format",
    });
    assert.deepEqual(validateShortLinkCode("abc-23"), {
      ok: false,
      reason: "invalid_format",
    });
    assert.deepEqual(validateShortLinkCode("abcd"), { ok: false, reason: "too_short" });
    assert.deepEqual(validateShortLinkCode("admin"), { ok: false, reason: "reserved" });
  });

  it("generates lowercase alphanumeric codes from the durable alphabet", () => {
    const code = generateShortLinkCode({ random: () => 0 });

    assert.equal(code.length, SHORT_LINK_CODE_LENGTH);
    assert.equal(SHORT_LINK_CODE_PATTERN.test(code), true);
    assert.equal(code, "2".repeat(SHORT_LINK_CODE_LENGTH));
    assert.throws(() => generateShortLinkCode({ length: 4 }), /Short link codes must be/);
  });

  it("skips reserved and already-taken codes when reserving", async () => {
    const { db } = createShortLinkDb({
      shortLinks: [
        {
          _id: "link-taken",
          code: "taken1",
          targetType: "profile",
          targetProfileId: "profile-existing",
          createdAt: 1,
        },
      ],
    });

    assert.deepEqual(await checkShortLinkCodeAvailability(db, " ADMIN "), {
      available: false,
      code: "admin",
      reason: "reserved",
    });
    assert.deepEqual(await checkShortLinkCodeAvailability(db, " Taken1 "), {
      available: false,
      code: "taken1",
      reason: "taken",
    });
    assert.equal(
      await findAvailableShortLinkCode(db, {
        generateCode: (attempt) =>
          attempt === 1 ? "admin" : attempt === 2 ? "taken1" : "fresh1",
      }),
      "fresh1",
    );
  });
});

describe("short link target reservations", () => {
  it("authorizes reservations for owned profiles, attributed worlds, and manageable events", async () => {
    const userId = "user-owner" as Id<"users">;
    const profileId = "profile-owned" as Id<"profiles">;
    const communityProfileId = "profile-community" as Id<"profiles">;
    const worldId = "world-attributed" as Id<"worlds">;
    const submittedEventId = "event-submitted" as Id<"events">;
    const communityEventId = "event-community" as Id<"events">;
    const submitter = {
      tokenIdentifier: "test|submitter",
      issuer: "test",
      subject: "submitter",
    };
    const manager = {
      tokenIdentifier: "test|manager",
      issuer: "test",
      subject: "manager",
    };
    const { db } = createShortLinkDb({
      profiles: [
        { _id: profileId },
        { _id: communityProfileId },
      ],
      profileOwners: [
        {
          _id: "owner-profile",
          profileId,
          userId,
          roleKey: "owner",
          state: "active",
        },
      ],
      communityAuthorities: [
        {
          _id: "authority-profile-manager",
          communityProfileId,
          subjectTokenIdentifier: manager.tokenIdentifier,
          state: "active",
          capabilities: ["manage_profile"],
        },
        {
          _id: "authority-event-manager",
          communityProfileId,
          subjectTokenIdentifier: manager.tokenIdentifier,
          state: "active",
          capabilities: ["manage_events"],
        },
      ],
      worlds: [
        {
          _id: worldId,
          creatorAttributions: [
            {
              role: "world_author",
              displayName: "Afterglow Social",
              profileId: communityProfileId,
            },
          ],
        },
      ],
      events: [
        {
          _id: submittedEventId,
          submitter,
        },
        {
          _id: communityEventId,
          communityProfileId,
        },
      ],
    });

    assert.equal(
      await canReserveShortLinkForTarget(
        db,
        { targetType: "profile", targetId: profileId },
        { userId, subject: submitter },
      ),
      true,
    );
    assert.equal(
      await canReserveShortLinkForTarget(
        db,
        { targetType: "profile", targetId: communityProfileId },
        { userId: "user-manager" as Id<"users">, subject: manager },
      ),
      true,
    );
    assert.equal(
      await canReserveShortLinkForTarget(
        db,
        { targetType: "world", targetId: worldId },
        { userId: "user-manager" as Id<"users">, subject: manager },
      ),
      true,
    );
    assert.equal(
      await canReserveShortLinkForTarget(
        db,
        { targetType: "event", targetId: submittedEventId },
        { userId, subject: submitter },
      ),
      true,
    );
    assert.equal(
      await canReserveShortLinkForTarget(
        db,
        { targetType: "event", targetId: communityEventId },
        { userId: "user-manager" as Id<"users">, subject: manager },
      ),
      true,
    );
  });

  it("rejects reservations when the signed-in actor lacks target authority", async () => {
    const actor = {
      userId: "user-unrelated" as Id<"users">,
      subject: {
        tokenIdentifier: "test|unrelated",
        issuer: "test",
        subject: "unrelated",
      },
    };
    const { db } = createShortLinkDb({
      profiles: [{ _id: "profile-owned" }],
      profileOwners: [
        {
          _id: "owner-profile",
          profileId: "profile-owned",
          userId: "user-owner",
          roleKey: "owner",
          state: "active",
        },
      ],
      worlds: [
        {
          _id: "world-attributed",
          creatorAttributions: [
            {
              role: "world_author",
              displayName: "DJ Aurora",
              profileId: "profile-owned",
            },
          ],
        },
      ],
      events: [
        {
          _id: "event-submitted",
          submitter: {
            tokenIdentifier: "test|submitter",
            issuer: "test",
            subject: "submitter",
          },
        },
      ],
    });

    assert.equal(
      await canReserveShortLinkForTarget(
        db,
        { targetType: "profile", targetId: "profile-owned" as Id<"profiles"> },
        actor,
      ),
      false,
    );
    assert.equal(
      await canReserveShortLinkForTarget(
        db,
        { targetType: "world", targetId: "world-attributed" as Id<"worlds"> },
        actor,
      ),
      false,
    );
    assert.equal(
      await canReserveShortLinkForTarget(
        db,
        { targetType: "event", targetId: "event-submitted" as Id<"events"> },
        actor,
      ),
      false,
    );
  });

  it("reuses an existing target reservation without changing the code", async () => {
    const profileId = "profile-existing" as Id<"profiles">;
    const { db, inserted } = createShortLinkDb({
      profiles: [{ _id: profileId }],
      shortLinks: [
        {
          _id: "link-existing",
          code: "keep1",
          targetType: "profile",
          targetProfileId: profileId,
          createdAt: 1,
        },
      ],
    });

    const reservation = await ensureShortLinkForTarget(
      db,
      { targetType: "profile", targetId: profileId },
      2,
    );

    assert.equal(reservation.code, "keep1");
    assert.equal(reservation.shortLinkPath, "/l/keep1");
    assert.equal(inserted.length, 0);
  });

  it("creates a generated reservation for an existing target", async () => {
    const profileId = "profile-new" as Id<"profiles">;
    const { db, inserted } = createShortLinkDb({
      profiles: [{ _id: profileId }],
    });

    const reservation = await ensureShortLinkForTarget(
      db,
      { targetType: "profile", targetId: profileId },
      5,
      { generateCode: () => "fresh1" },
    );

    assert.equal(reservation.code, "fresh1");
    assert.equal(reservation.shortLinkPath, "/l/fresh1");
    assert.deepEqual(inserted, [
      {
        table: "shortLinks",
        document: {
          code: "fresh1",
          targetType: "profile",
          targetProfileId: profileId,
          createdAt: 5,
        },
      },
    ]);
  });

  it("rejects absent targets before reserving a code", async () => {
    const { db } = createShortLinkDb({});

    await assert.rejects(
      () =>
        ensureShortLinkForTarget(
          db,
          { targetType: "profile", targetId: "profile-missing" as Id<"profiles"> },
          5,
          { generateCode: () => "fresh1" },
        ),
      /Short link target was not found/,
    );
  });
});

describe("public short link resolution", () => {
  it("resolves public profile, world, and event targets to canonical routes", async () => {
    const profile = {
      _id: "profile-public",
      slug: "dj-aurora",
      profileType: "person",
      publicationState: "published",
      publicSurfacingState: "public",
    } as Doc<"profiles">;
    const world = {
      _id: "world-public",
      slug: "neon-harbor",
      publicationState: "published",
    } as Doc<"worlds">;
    const event = {
      _id: "event-public",
      slug: "afterglow-harbor",
      title: "Afterglow Harbor",
      sortTitle: "afterglow harbor",
      startAt: 5,
      sourceType: "community",
      sourceLabel: "Fixture",
      publicationState: "published",
      updatedAt: 5,
    } as Doc<"events">;
    const { db } = createShortLinkDb({
      profiles: [profile],
      worlds: [world],
      events: [event],
      shortLinks: [
        {
          _id: "link-profile",
          code: "prof1",
          targetType: "profile",
          targetProfileId: profile._id,
          createdAt: 1,
        },
        {
          _id: "link-world",
          code: "world1",
          targetType: "world",
          targetWorldId: world._id,
          createdAt: 1,
        },
        {
          _id: "link-event",
          code: "event1",
          targetType: "event",
          targetEventId: event._id,
          createdAt: 1,
        },
      ],
    });

    assert.deepEqual(await resolvePublicShortLinkTarget(db, " PROF1 "), {
      code: "prof1",
      targetType: "profile",
      path: "/p/dj-aurora",
    });
    assert.deepEqual(await resolvePublicShortLinkTarget(db, "world1"), {
      code: "world1",
      targetType: "world",
      path: "/w/neon-harbor",
    });
    assert.deepEqual(await resolvePublicShortLinkTarget(db, "event1"), {
      code: "event1",
      targetType: "event",
      path: "/e/afterglow-harbor",
    });
  });

  it("returns null for absent, draft, and suppressed public targets", async () => {
    const suppressedProfile = {
      _id: "profile-suppressed",
      slug: "hidden-profile",
      profileType: "person",
      publicationState: "published",
      publicSurfacingState: "suppressed",
    } as Doc<"profiles">;
    const draftWorld = {
      _id: "world-draft",
      slug: "draft-world",
      publicationState: "draft_private",
    } as Doc<"worlds">;
    const { db } = createShortLinkDb({
      profiles: [suppressedProfile],
      worlds: [draftWorld],
      shortLinks: [
        {
          _id: "link-suppressed",
          code: "hide1",
          targetType: "profile",
          targetProfileId: suppressedProfile._id,
          createdAt: 1,
        },
        {
          _id: "link-draft",
          code: "draft1",
          targetType: "world",
          targetWorldId: draftWorld._id,
          createdAt: 1,
        },
      ],
    });

    assert.equal(await resolvePublicShortLinkTarget(db, "missing1"), null);
    assert.equal(await resolvePublicShortLinkTarget(db, "hide1"), null);
    assert.equal(await resolvePublicShortLinkTarget(db, "draft1"), null);
  });
});
