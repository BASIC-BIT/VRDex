import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DatabaseReader } from "../../convex/_generated/server";
import {
  findSlugOwner,
  isReservedSlug,
  isRoutePrefixSlug,
  routePrefixSubpaths,
  validateSlugFormat,
} from "../../convex/_globalSlugs";
import { checkEventSlugAvailability, findAvailableEventSlug } from "../../convex/_eventSlugs";
import { checkProfileSlugAvailability } from "../../convex/_profileSlugs";
import { checkWorldSlugAvailability } from "../../convex/_worldSlugs";

type SlugTable = "profiles" | "worlds" | "events";

function createSlugTestDb(rows: Partial<Record<SlugTable, Array<Record<string, unknown>>>>) {
  const tables: Record<SlugTable, Array<Record<string, unknown>>> = {
    profiles: rows.profiles ?? [],
    worlds: rows.worlds ?? [],
    events: rows.events ?? [],
  };

  return {
    query(tableName: SlugTable) {
      return {
        withIndex(
          _indexName: string,
          builder: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
        ) {
          const filters: Array<{ field: string; value: unknown }> = [];
          const query = {
            eq(field: string, value: unknown) {
              filters.push({ field, value });
              return query;
            },
          };

          builder(query);

          return {
            async unique() {
              const matches = tables[tableName].filter((row) =>
                filters.every((filter) => row[filter.field] === filter.value),
              );

              if (matches.length > 1) {
                throw new Error("Expected unique query result.");
              }

              return matches[0] ?? null;
            },
          };
        },
      };
    },
  } as unknown as DatabaseReader;
}

describe("global slug namespace", () => {
  it("refuses a slug another entity type already holds", async () => {
    const db = createSlugTestDb({
      profiles: [{ _id: "profile1", slug: "afterglow", profileType: "community" }],
      worlds: [{ _id: "world1", slug: "neon-harbor" }],
      events: [{ _id: "event1", slug: "harbor-sessions" }],
    });

    // A world cannot take the community's name, and vice versa: both render from
    // the site root, so only one of them could ever answer /afterglow.
    assert.deepEqual(await checkWorldSlugAvailability(db, "afterglow"), {
      available: false,
      slug: "afterglow",
      reason: "taken",
    });
    assert.deepEqual(await checkProfileSlugAvailability(db, "neon-harbor"), {
      available: false,
      slug: "neon-harbor",
      reason: "taken",
    });
    assert.deepEqual(await checkEventSlugAvailability(db, "afterglow"), {
      available: false,
      slug: "afterglow",
      reason: "taken",
    });
    assert.deepEqual(await checkProfileSlugAvailability(db, "harbor-sessions"), {
      available: false,
      slug: "harbor-sessions",
      reason: "taken",
    });

    assert.deepEqual(await checkProfileSlugAvailability(db, "unclaimed-name"), {
      available: true,
      slug: "unclaimed-name",
    });
  });

  it("lets an entity keep its own slug through an update", async () => {
    const db = createSlugTestDb({
      worlds: [{ _id: "world1", slug: "neon-harbor" }],
    });

    assert.deepEqual(await checkWorldSlugAvailability(db, "neon-harbor", "world1" as never), {
      available: true,
      slug: "neon-harbor",
    });
  });

  it("refuses reserved names on every entity type", async () => {
    const db = createSlugTestDb({});

    for (const reserved of ["lookup", "submit", "settings", "basic"]) {
      assert.equal(isReservedSlug(reserved), true, `${reserved} should be reserved`);

      for (const check of [
        checkProfileSlugAvailability,
        checkWorldSlugAvailability,
        checkEventSlugAvailability,
      ]) {
        assert.deepEqual(await check(db, reserved), {
          available: false,
          slug: reserved,
          reason: "reserved",
        });
      }
    }
  });

  it("still resolves a reserved name an operator has already granted", async () => {
    // `basic` is held back from self-serve, but once it is written to a row it has to
    // resolve -- otherwise granting a premium name would produce a 404.
    const db = createSlugTestDb({
      profiles: [{ _id: "profile1", slug: "basic", profileType: "person" }],
    });

    assert.equal(validateSlugFormat("basic").ok, true);

    const owner = await findSlugOwner(db, "basic");

    assert.equal(owner?.kind, "person");
  });

  it("refuses a named event slug rather than suffixing it", async () => {
    const db = createSlugTestDb({
      profiles: [{ _id: "profile1", slug: "afterglow", profileType: "community" }],
    });

    // Derived-from-title slugs may be suffixed; a slug the caller named is a public
    // address they chose. Returning `afterglow-2` would hand back a different one
    // and report success.
    await assert.rejects(
      () => findAvailableEventSlug(db, { title: "Afterglow", preferredSlug: "afterglow" }),
      /already taken/,
    );

    await assert.rejects(
      () => findAvailableEventSlug(db, { title: "Support", preferredSlug: "support" }),
      /reserved/,
    );

    // Nothing named, so the allocator is free to pick around a collision.
    assert.equal(
      await findAvailableEventSlug(db, { title: "Afterglow" }),
      "afterglow-2",
    );
  });

  it("lets an event keep a reserved slug it already holds", async () => {
    // `updateCommunityEventRecord` passes the event's own slug as the preferred
    // value on every edit, so refusing reserved names unconditionally locked an
    // event that owns a granted premium name out of all editing, summary changes
    // included. Reserved means "not handed out", not "cannot be kept".
    const db = createSlugTestDb({ events: [{ _id: "event1", slug: "club" }] });

    assert.equal(isReservedSlug("club"), true);
    assert.equal(
      await findAvailableEventSlug(
        db,
        { title: "Club Night", preferredSlug: "club" },
        { excludingEventId: "event1" as never },
      ),
      "club",
    );

    // Still refused for anyone who does not already hold it.
    await assert.rejects(
      () => findAvailableEventSlug(db, { title: "Club Night", preferredSlug: "club" }),
      /reserved/,
    );
    await assert.rejects(
      () =>
        findAvailableEventSlug(
          db,
          { title: "Club Night", preferredSlug: "club" },
          { excludingEventId: "event2" as never },
        ),
      /reserved/,
    );
  });

  it("lets an event keep its own slug through an update", async () => {
    // `events.ts` passes the event's current slug as the preferred value on every
    // update, so excluding itself is what stops an unrelated edit from throwing.
    const db = createSlugTestDb({
      events: [{ _id: "event1", slug: "harbor-sessions" }],
    });

    assert.equal(
      await findAvailableEventSlug(
        db,
        { title: "Harbor Sessions", preferredSlug: "harbor-sessions" },
        { excludingEventId: "event1" as never },
      ),
      "harbor-sessions",
    );
  });

  it("lets any entity keep a reserved slug it already holds", async () => {
    // `ops:profile-rename` passes the current slug back as `--new-slug`, so an
    // idempotent rename of the profile called `basic` failed on the reserved gate
    // before the ownership check could see it was the same row. Events learned this
    // in an earlier round and profiles did not, which is what sharing one
    // implementation between the three now prevents.
    const db = createSlugTestDb({
      profiles: [{ _id: "profile1", slug: "basic", profileType: "person" }],
      worlds: [{ _id: "world1", slug: "club" }],
      events: [{ _id: "event1", slug: "stage" }],
    });

    assert.deepEqual(await checkProfileSlugAvailability(db, "basic", "profile1" as never), {
      available: true,
      slug: "basic",
    });
    assert.deepEqual(await checkWorldSlugAvailability(db, "club", "world1" as never), {
      available: true,
      slug: "club",
    });
    assert.deepEqual(await checkEventSlugAvailability(db, "stage", "event1" as never), {
      available: true,
      slug: "stage",
    });

    // Nobody else may take them, and holding one row does not unlock another's.
    assert.deepEqual(await checkProfileSlugAvailability(db, "basic"), {
      available: false,
      slug: "basic",
      reason: "reserved",
    });
    assert.deepEqual(await checkProfileSlugAvailability(db, "club", "profile1" as never), {
      available: false,
      slug: "club",
      reason: "reserved",
    });
  });

  it("answers the prefix lookup safely for slugs that name Object members", () => {
    // Slugs come from users, and `constructor` passes validation and is reserved by
    // nothing. Keyed on a plain object this lookup returned `Object` rather than
    // undefined, so the `?? []` fallback never fired and the caller's `.includes`
    // threw -- inside the deployment audit, the one tool expected to work before a
    // rollout.
    for (const slug of ["constructor", "hasownproperty", "prototype", "tostring"]) {
      assert.equal(validateSlugFormat(slug).ok, true, `${slug} is a legal slug`);
      assert.deepEqual(routePrefixSubpaths(slug), []);
      assert.equal(isRoutePrefixSlug(slug), false);
      assert.equal(isReservedSlug(slug), false);
    }

    // Still correct for a real one.
    assert.deepEqual([...routePrefixSubpaths("handoff")].sort(), ["calendar.ics", "edit"]);
  });

  it("resolves the owner across all three tables", async () => {
    const db = createSlugTestDb({
      profiles: [{ _id: "profile1", slug: "afterglow", profileType: "community" }],
      worlds: [{ _id: "world1", slug: "neon-harbor" }],
      events: [{ _id: "event1", slug: "harbor-sessions" }],
    });

    assert.equal((await findSlugOwner(db, "afterglow"))?.kind, "community");
    assert.equal((await findSlugOwner(db, "neon-harbor"))?.kind, "world");
    assert.equal((await findSlugOwner(db, "harbor-sessions"))?.kind, "event");
    assert.equal(await findSlugOwner(db, "nobody-here"), null);
  });
});
