import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalDestinationArtworkQuery, createDestinationArtworkCache } from "../../apps/web/src/lib/server/profile-link-destination-artwork-cache";

const source = { key: "discord_guild:invite", kind: "discord_guild" as const, artworkSourceUrl: "https://cdn.discordapp.com/icons/12345/1234567890abcdef1234567890abcdef.png?size=128" };

test("cold cache imports and persists artwork when S3 hides missing keys with AccessDenied", async () => {
  const storage = new Map<string, Uint8Array>();
  const bytes = new Uint8Array([1, 2, 3]);
  let fetches = 0;
  const dependencies = {
    read: async (key: string) => {
      const body = storage.get(key);
      if (!body) throw Object.assign(new Error("Access Denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
      return { body };
    },
    write: async (key: string, body: Uint8Array) => { storage.set(key, body); },
    prepare: async () => { fetches++; return bytes; },
    now: () => 1_000_000,
  };
  assert.deepEqual(await createDestinationArtworkCache(dependencies)(source), bytes);
  assert.equal(storage.size, 1);
  assert.deepEqual(await createDestinationArtworkCache(dependencies)(source), bytes);
  assert.equal(fetches, 1);
});

test("cache read failures other than AccessDenied do not trigger provider imports", async () => {
  const failure = new Error("storage unavailable");
  const cache = createDestinationArtworkCache({
    read: async () => { throw failure; },
    write: async () => { assert.fail("must not write after an unknown read failure"); },
    prepare: async () => { assert.fail("must not fetch after an unknown read failure"); },
    now: () => 1_000_000,
  });
  await assert.rejects(cache(source), error => error === failure);
});

test("AccessDenied cache reads still require successful persistence of newly prepared artwork", async () => {
  const denied = Object.assign(new Error("Access Denied"), { name: "AccessDenied" });
  const writeDenied = Object.assign(new Error("Write denied"), { name: "AccessDenied" });
  const cache = createDestinationArtworkCache({
    read: async () => { throw denied; },
    write: async () => { throw writeDenied; },
    prepare: async () => new Uint8Array([1]),
    now: () => 1_000_000,
  });
  await assert.rejects(cache(source), error => error === writeDenied);
});

test("cold instances retain stored last-known thumbnail when providers fail after freshness expires", async () => {
  const storage = new Map<string, Uint8Array>();
  let now = 1_000_000;
  let fetches = 0;
  const bytes = new Uint8Array([1, 2, 3]);
  const dependencies = {
    read: async (key: string) => storage.has(key) ? { body: storage.get(key)! } : null,
    write: async (key: string, body: Uint8Array) => { storage.set(key, body); },
    prepare: async () => { fetches++; return bytes; },
    now: () => now,
  };
  assert.deepEqual(await createDestinationArtworkCache(dependencies)(source), bytes);
  now += 2 * 86_400_000;
  const failed = { ...dependencies, prepare: async () => { fetches++; throw new Error("provider outage"); } };
  assert.deepEqual(await createDestinationArtworkCache(failed)(source), bytes);
  // New process after the failed refresh must use the persisted retry delay too.
  assert.deepEqual(await createDestinationArtworkCache(failed)(source), bytes);
  assert.equal(fetches, 2);
  assert.equal(storage.size, 1);
});

test("query cache busting cannot select a new cache identity or bypass freshness", async () => {
  assert.equal(canonicalDestinationArtworkQuery(new URLSearchParams("profile=p&v=123"), 123), true);
  for (const query of ["profile=p&v=456", "profile=p&v=123&nonce=1", "profile=p&v=123&v=456", "profile=p&profile=q&v=123"]) {
    assert.equal(canonicalDestinationArtworkQuery(new URLSearchParams(query), 123), false);
  }
  let calls = 0;
  const storage = new Map<string, Uint8Array>();
  const cache = createDestinationArtworkCache({
    read: async key => storage.has(key) ? { body: storage.get(key)! } : null,
    write: async (key, body) => { storage.set(key, body); },
    prepare: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return new Uint8Array([1]); },
    now: () => 1_000_000,
  });
  await Promise.all(Array.from({ length: 20 }, () => cache(source)));
  await cache(source);
  assert.equal(calls, 1);
});

test("changed destination artwork never falls back to a previous destination's bytes", async () => {
  const storage = new Map<string, Uint8Array>();
  let unavailable = false;
  const cache = createDestinationArtworkCache({
    read: async key => storage.has(key) ? { body: storage.get(key)! } : null,
    write: async (key, body) => { storage.set(key, body); },
    prepare: async () => { if (unavailable) throw new Error("outage"); return new Uint8Array([1]); },
    now: () => 1_000_000,
  });
  assert.deepEqual(await cache(source), new Uint8Array([1]));
  unavailable = true;
  assert.equal(await cache({ ...source, artworkSourceUrl: source.artworkSourceUrl.replace("12345/", "54321/") }), null);
});
