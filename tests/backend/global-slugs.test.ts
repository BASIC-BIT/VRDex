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

      for (const check of [checkProfileSlugAvailability, checkWorldSlugAvailability]) {
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

  it("lets either root entity keep a reserved slug it already holds", async () => {
    // `ops:profile-rename` passes the current slug back as `--new-slug`, so an
    // idempotent rename of the profile called `basic` failed on the reserved gate
    // before the ownership check could see it was the same row.
    const db = createSlugTestDb({
      profiles: [{ _id: "profile1", slug: "basic", profileType: "person" }],
      worlds: [{ _id: "world1", slug: "club" }],
    });

    assert.deepEqual(await checkProfileSlugAvailability(db, "basic", "profile1" as never), {
      available: true,
      slug: "basic",
    });
    assert.deepEqual(await checkWorldSlugAvailability(db, "club", "world1" as never), {
      available: true,
      slug: "club",
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

  it("still reports taken when a later table also holds the excluded row's slug", async () => {
    // `findSlugOwner` reports its first match, and profiles come first. Comparing an
    // unexcluded lookup against the excluded id therefore saw the profile keeping
    // `afterglow` and never looked at the world also holding it, answering available
    // on exactly the legacy duplicates the audit exists to find.
    const db = createSlugTestDb({
      profiles: [{ _id: "profile1", slug: "afterglow", profileType: "person" }],
      worlds: [{ _id: "world1", slug: "afterglow" }],
    });

    assert.deepEqual(await checkProfileSlugAvailability(db, "afterglow", "profile1" as never), {
      available: false,
      slug: "afterglow",
      reason: "taken",
    });
    assert.deepEqual(await checkWorldSlugAvailability(db, "afterglow", "world1" as never), {
      available: false,
      slug: "afterglow",
      reason: "taken",
    });

    // Once the duplicate is resolved, the remaining holder keeps it.
    const settled = createSlugTestDb({
      profiles: [{ _id: "profile1", slug: "afterglow", profileType: "person" }],
    });

    assert.deepEqual(await checkProfileSlugAvailability(settled, "afterglow", "profile1" as never), {
      available: true,
      slug: "afterglow",
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
    assert.deepEqual([...routePrefixSubpaths("handoff")].sort(), [
      "calendar.ics",
      "edit",
      "opengraph-image",
    ]);
  });

  it("resolves the owner across both root entity tables", async () => {
    const db = createSlugTestDb({
      profiles: [{ _id: "profile1", slug: "afterglow", profileType: "community" }],
      worlds: [{ _id: "world1", slug: "neon-harbor" }],
    });

    assert.equal((await findSlugOwner(db, "afterglow"))?.kind, "community");
    assert.equal((await findSlugOwner(db, "neon-harbor"))?.kind, "world");
    assert.equal(await findSlugOwner(db, "nobody-here"), null);
  });
});
