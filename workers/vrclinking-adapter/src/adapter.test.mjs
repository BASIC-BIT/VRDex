import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateRequest, verifyLinkage } from "./adapter.mjs";
import { SecretResolutionError, classifySecretRef, extractToken } from "./secret-resolver.mjs";
import { VrclinkingProviderError, createVrclinkingClient } from "./vrclinking-client.mjs";

const DISCORD_ID = "123456789012345678";
const VRC_ID = "usr_11111111-2222-3333-4444-555555555555";
const OTHER_VRC_ID = "usr_99999999-8888-7777-6666-555555555555";
const DELEGATION = { guildId: "12345678901234567", secretRef: "secret://community-a" };

function baseBody(overrides = {}) {
  return {
    targetType: "vrclinking",
    discordUserId: DISCORD_ID,
    targetExternalId: VRC_ID,
    delegations: [DELEGATION],
    ...overrides,
  };
}

const resolveSecret = async () => "token";

describe("adapter request validation", () => {
  it("accepts a well-formed request and caps delegation fan-out", () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      guildId: `1234567890123456${index}`,
      secretRef: `secret://c${index}`,
    }));
    const result = validateRequest(baseBody({ delegations: many }));

    assert.equal(result.ok, true);
    assert.equal(result.request.delegations.length, 5);
  });

  it("rejects malformed identifiers and missing delegations", () => {
    assert.equal(validateRequest(null).ok, false);
    assert.equal(validateRequest(baseBody({ targetType: "vrchat_user" })).error, "unsupported_target_type");
    assert.equal(validateRequest(baseBody({ discordUserId: "nope" })).error, "invalid_discord_user_id");
    assert.equal(validateRequest(baseBody({ targetExternalId: "grp_x" })).error, "invalid_target_external_id");
    assert.equal(validateRequest(baseBody({ delegations: [] })).error, "no_delegations");
    assert.equal(validateRequest(baseBody({ delegations: [{ guildId: 1 }] })).error, "no_delegations");
  });
});

describe("linkage verification", () => {
  const request = validateRequest(baseBody()).request;

  it("attests only a verified link to the exact claimed account", async () => {
    const result = await verifyLinkage({
      request,
      resolveSecret,
      getGuildMemberByDiscordId: async () => ({
        id: DISCORD_ID,
        vrcId: VRC_ID,
        isVerified: true,
      }),
    });

    assert.equal(result.verified, true);
    assert.equal(result.evidenceSource, "vrclinking");
  });

  it("refuses an unverified link", async () => {
    const result = await verifyLinkage({
      request,
      resolveSecret,
      getGuildMemberByDiscordId: async () => ({
        id: DISCORD_ID,
        vrcId: VRC_ID,
        isVerified: false,
      }),
    });

    assert.equal(result.verified, false);
    assert.equal(result.unavailable, undefined);
  });

  it("refuses a link to a different VRChat account", async () => {
    const result = await verifyLinkage({
      request,
      resolveSecret,
      getGuildMemberByDiscordId: async () => ({
        id: DISCORD_ID,
        vrcId: OTHER_VRC_ID,
        isVerified: true,
      }),
    });

    assert.equal(result.verified, false);
  });

  it("reports a rejected credential as unavailable, not as a failed claim", async () => {
    const result = await verifyLinkage({
      request,
      resolveSecret,
      getGuildMemberByDiscordId: async () => {
        throw new VrclinkingProviderError("nope", { reason: "credential_rejected" });
      },
    });

    assert.equal(result.verified, false);
    assert.equal(result.unavailable, true);
  });

  // A broken credential must not be reported as "VRCLinking says no", which
  // sends the user to re-check a proof when the real fault is operator-side.
  it("treats a secret that will not resolve as unavailable, not a negative", async () => {
    for (const reason of ["empty_secret", "malformed_secret", "unsupported_reference"]) {
      const result = await verifyLinkage({
        request,
        resolveSecret: async () => {
          throw new SecretResolutionError("nope", { reason });
        },
        getGuildMemberByDiscordId: async () => null,
      });

      assert.equal(result.verified, false, reason);
      assert.equal(result.unavailable, true, reason);
    }
  });

  it("treats malformed provider JSON as unavailable", async () => {
    const result = await verifyLinkage({
      request,
      resolveSecret,
      getGuildMemberByDiscordId: async () => {
        throw new VrclinkingProviderError("bad json", { reason: "schema_drift" });
      },
    });

    assert.equal(result.verified, false);
    assert.equal(result.unavailable, true);
  });

  it("treats a member who is simply absent as a plain negative", async () => {
    const result = await verifyLinkage({
      request,
      resolveSecret,
      getGuildMemberByDiscordId: async () => null,
    });

    assert.equal(result.verified, false);
    assert.equal(result.unavailable, undefined);
  });

  it("keeps trying later delegations after one fails", async () => {
    const twoDelegations = validateRequest(
      baseBody({
        delegations: [
          { guildId: "11111111111111111", secretRef: "secret://broken" },
          DELEGATION,
        ],
      }),
    ).request;
    const result = await verifyLinkage({
      request: twoDelegations,
      resolveSecret,
      getGuildMemberByDiscordId: async (guildId) => {
        if (guildId === "11111111111111111") {
          throw new VrclinkingProviderError("down", { reason: "provider_error" });
        }

        return { id: DISCORD_ID, vrcId: VRC_ID, isVerified: true };
      },
    });

    assert.equal(result.verified, true);
  });

  it("never echoes provider data back to the control plane", async () => {
    const result = await verifyLinkage({
      request,
      resolveSecret,
      getGuildMemberByDiscordId: async () => ({
        id: DISCORD_ID,
        vrcId: VRC_ID,
        vrcName: "Secret Display Name",
        username: "discord-handle",
        isVerified: true,
      }),
    });

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("Secret Display Name"), false);
    assert.equal(serialized.includes("discord-handle"), false);
    assert.equal(serialized.includes(VRC_ID), false);
  });
});

describe("secret references", () => {
  it("reads plain and JSON secret payloads", () => {
    assert.equal(extractToken("  raw-token  "), "raw-token");
    assert.equal(extractToken('{"token":"json-token"}'), "json-token");
    assert.equal(extractToken('{"apiKey":"alt-token"}'), "alt-token");
  });

  it("rejects empty and malformed payloads", () => {
    assert.throws(() => extractToken(""), /empty/i);
    assert.throws(() => extractToken("{not json"), /JSON/i);
    assert.throws(() => extractToken('{"nope":1}'), /token field/i);
  });

  it("accepts only supported references and blocks traversal", () => {
    assert.equal(classifySecretRef("arn:aws:secretsmanager:us-east-1:1:secret:a").kind, "aws");
    assert.equal(classifySecretRef("secret://community-a").kind, "local");
    assert.equal(classifySecretRef("secret://../../etc/passwd").kind, "invalid");
    assert.equal(classifySecretRef("https://example.test/token").kind, "invalid");
    assert.equal(classifySecretRef(undefined).kind, "invalid");
  });
});

describe("VRCLinking client", () => {
  function clientWith(status, payload) {
    return createVrclinkingClient({
      baseUrl: "https://provider.test/api",
      fetcher: async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
      }),
    });
  }

  it("requires an exact Discord id match rather than the first fuzzy row", async () => {
    const get = clientWith(200, {
      results: [
        { id: "999999999999999999", vrcId: OTHER_VRC_ID, isVerified: true },
        { id: DISCORD_ID, vrcId: VRC_ID, isVerified: true },
      ],
    });

    assert.equal((await get("guild", DISCORD_ID, "t"))?.vrcId, VRC_ID);
    assert.equal(await clientWith(200, { results: [] })("guild", DISCORD_ID, "t"), null);
  });

  // A response without a `results` array is drift, not an empty search. Read as
  // an empty search it becomes a real negative: the claimant is told they are
  // not linked because the provider changed its shape.
  it("refuses to read a missing results array as an empty search", async () => {
    for (const payload of [{}, { results: null }, { results: { id: DISCORD_ID } }, []]) {
      await assert.rejects(
        () => clientWith(200, payload)("guild", DISCORD_ID, "t"),
        (error) => error.reason === "schema_drift",
      );
    }
  });

  // The provider search is fuzzy and paginated, so the exact id can land past
  // page one. Stopping at the first page reports a linked claimant as unlinked.
  it("pages until the exact id is found or the pages run out", async () => {
    const pages = [];
    const get = createVrclinkingClient({
      baseUrl: "https://provider.test/api",
      fetcher: async (url) => {
        const page = Number(new URL(url).searchParams.get("page"));
        pages.push(page);

        return {
          ok: true,
          status: 200,
          json: async () => ({
            totalPages: 3,
            results:
              page === 3
                ? [{ id: DISCORD_ID, vrcId: VRC_ID, isVerified: true }]
                : [{ id: "999999999999999999", vrcId: OTHER_VRC_ID, isVerified: true }],
          }),
        };
      },
    });

    assert.equal((await get("guild", DISCORD_ID, "t"))?.vrcId, VRC_ID);
    assert.deepEqual(pages, [1, 2, 3]);

    // A genuinely absent member still stops at the last page rather than looping.
    const missPages = [];
    const miss = createVrclinkingClient({
      baseUrl: "https://provider.test/api",
      fetcher: async (url) => {
        missPages.push(Number(new URL(url).searchParams.get("page")));

        return {
          ok: true,
          status: 200,
          json: async () => ({
            totalPages: 2,
            results: [{ id: "999999999999999999", vrcId: OTHER_VRC_ID, isVerified: true }],
          }),
        };
      },
    });

    assert.equal(await miss("guild", DISCORD_ID, "t"), null);
    assert.deepEqual(missPages, [1, 2]);
  });

  it("surfaces a rejected credential distinctly from a missing member", async () => {
    await assert.rejects(
      () => clientWith(401, {})("guild", DISCORD_ID, "t"),
      (error) => error.reason === "credential_rejected",
    );
    assert.equal(await clientWith(404, {})("guild", DISCORD_ID, "t"), null);
    await assert.rejects(
      () => clientWith(429, {})("guild", DISCORD_ID, "t"),
      (error) => error.reason === "rate_limited",
    );
  });

  it("sends the bearer token and an exact-match query", async () => {
    let seenUrl;
    let seenHeaders;
    const get = createVrclinkingClient({
      baseUrl: "https://provider.test/api",
      fetcher: async (url, options) => {
        seenUrl = url;
        seenHeaders = options.headers;

        return { ok: true, status: 200, json: async () => ({ results: [] }) };
      },
    });

    await get("guild-1", DISCORD_ID, "tok");

    assert.equal(seenUrl.includes("searchBy=DiscordId"), true);
    assert.equal(seenUrl.includes(DISCORD_ID), true);
    assert.equal(seenHeaders.authorization, "Bearer tok");
  });
});
