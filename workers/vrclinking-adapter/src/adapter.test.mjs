import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { validateRequest, verifyLinkage } from "./adapter.mjs";
import {
  SecretResolutionError,
  classifySecretRef,
  createSecretResolver,
  extractToken,
} from "./secret-resolver.mjs";
import { VrclinkingProviderError, createVrclinkingClient } from "./vrclinking-client.mjs";

const DISCORD_ID = "123456789012345678";
const VRC_ID = "usr_11111111-2222-3333-4444-555555555555";
const OTHER_VRC_ID = "usr_99999999-8888-7777-6666-555555555555";
const GUILD_ID = "123456789012345671";
// The adapter accepts only the one reference name provisioned for that guild;
// see `isSecretRefForGuild` in adapter.mjs.
const CAPABILITY_KEY = "playwright-capability-key";
process.env.VRDEX_VRCLINKING_CAPABILITY_KEY = CAPABILITY_KEY;

/** Mints what `convex/_delegationCapability.ts` mints, for the fixtures below. */
function signDelegation(guildId, secretRef, expiresAt) {
  return {
    guildId,
    secretRef,
    expiresAt,
    capability: createHmac("sha256", CAPABILITY_KEY)
      .update(`${guildId}\n${secretRef}\n${expiresAt}`)
      .digest("hex"),
  };
}

const FAR_FUTURE = Date.UTC(2099, 0, 1);
const DELEGATION = signDelegation(
  GUILD_ID,
  `secret://vrdex/vrclinking/${GUILD_ID}`,
  FAR_FUTURE,
);

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
    const many = Array.from({ length: 9 }, (_, index) =>
      signDelegation(
        `1234567890123456${index}`,
        `secret://vrdex/vrclinking/1234567890123456${index}`,
        FAR_FUTURE,
      ),
    );
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

  // The name check below is shape, not authorization: secret names are derived
  // from the guild id, so a caller holding the shared bearer token constructs a
  // matching pair as easily as VRDex does. Only the signature, made with a key
  // that token does not carry, tells the two apart.
  it("rejects a delegation without a valid, unexpired capability", () => {
    const secretRef = `secret://vrdex/vrclinking/${GUILD_ID}`;
    const unsigned = { guildId: GUILD_ID, secretRef };
    const forged = { ...DELEGATION, capability: "0".repeat(64) };
    // 64 characters, but not 64 bytes. `timingSafeEqual` throws on unequal
    // buffer lengths, and `validateRequest` runs outside the server's
    // per-request `try`, so this took the process down.
    const wideCharacters = { ...DELEGATION, capability: "é".repeat(64) };
    const expired = signDelegation(GUILD_ID, secretRef, Date.UTC(2020, 0, 1));
    // A capability for one guild must not carry another: the signature covers
    // the pair, so swapping the guild id invalidates it.
    const swapped = { ...DELEGATION, guildId: "999999999999999999" };

    for (const delegation of [unsigned, forged, wideCharacters, expired, swapped]) {
      assert.equal(validateRequest(baseBody({ delegations: [delegation] })).error, "no_delegations");
    }

    assert.equal(validateRequest(baseBody()).ok, true);
  });

  // Every index the control plane gets back is resolved against the batch it
  // sent, so dropping an entry must not renumber the survivors. It used to: a
  // match on the second delegation was reported as index 0, and Convex then
  // re-checked and stamped the first. Where the credential that answered had
  // been revoked mid-flight, the unrelated still-active row passed the re-check
  // in its place and the claim was granted on a revoked answer.
  it("reports the index a delegation had in the request, not after filtering", async () => {
    const goodGuild = "12345678901234599";
    const valid = signDelegation(
      goodGuild,
      `secret://vrdex/vrclinking/${goodGuild}`,
      FAR_FUTURE,
    );
    const dropped = { ...DELEGATION, capability: "f".repeat(64) };
    const validated = validateRequest(baseBody({ delegations: [dropped, valid] }));

    assert.equal(validated.ok, true);
    assert.equal(validated.request.delegations.length, 1);
    assert.equal(validated.request.delegations[0].requestIndex, 1);

    const result = await verifyLinkage({
      request: validated.request,
      resolveSecret,
      getGuildMemberByDiscordId: async () => ({
        id: DISCORD_ID,
        vrcId: VRC_ID,
        isVerified: true,
      }),
    });

    assert.equal(result.verified, true);
    assert.equal(result.matchedDelegationIndex, 1);
    assert.equal(result.matchedGuildId, goodGuild);
    assert.deepEqual(result.consultedDelegationIndexes, [1]);
  });

  // Convex abandons the adapter request at ten seconds. Five sequential
  // lookups with their own timeouts can outlast that, so a match found after
  // the caller gave up is unusable and every provider call past that point
  // spends another community's quota for nothing.
  it("stops the fan-out when the request budget is spent", async () => {
    const asked = [];
    let clock = 0;
    const request = validateRequest(
      baseBody({
        delegations: [0, 1, 2].map((offset) =>
          signDelegation(
            `12345678901234${567 + offset}`,
            `secret://vrdex/vrclinking/12345678901234${567 + offset}`,
            FAR_FUTURE,
          ),
        ),
      }),
    ).request;

    const result = await verifyLinkage({
      request,
      resolveSecret,
      deadlineMs: 8_000,
      now: () => clock,
      getGuildMemberByDiscordId: async (guildId) => {
        asked.push(guildId);
        clock += 5_000;
        return null;
      },
    });

    // Two lookups fit; the third would start past the budget.
    assert.equal(asked.length, 2);
    assert.equal(result.verified, false);
    assert.deepEqual(result.consultedDelegationIndexes, [0, 1]);
  });

  // Convex refuses to register a reference that does not name the guild it is
  // for, but the bearer token in front of this adapter is one shared
  // credential: a caller holding it posts straight here and never passes that
  // check. Since the deployment role can read every delegated tenant secret, an
  // unbound reference would spend another community's key.
  it("rejects a secret reference that does not name its own guild", () => {
    const foreign = signDelegation(
      GUILD_ID,
      "secret://vrdex/vrclinking/999999999999999999",
      FAR_FUTURE,
    );
    const traversal = signDelegation(
      GUILD_ID,
      `secret://vrdex/vrclinking/${GUILD_ID}/../other`,
      FAR_FUTURE,
    );
    const arn = signDelegation(
      GUILD_ID,
      `arn:aws:secretsmanager:us-east-1:123456789012:secret:vrdex/vrclinking/${GUILD_ID}-AbCdEf`,
      FAR_FUTURE,
    );

    assert.equal(validateRequest(baseBody({ delegations: [foreign] })).error, "no_delegations");
    assert.equal(validateRequest(baseBody({ delegations: [traversal] })).error, "no_delegations");
    assert.equal(
      validateRequest(baseBody({ delegations: [{ ...DELEGATION, guildId: "nope" }] })).error,
      "no_delegations",
    );
    // The ARN form is no longer accepted at either end. Its pattern allowed any
    // region and account while the execution role reads only its own, so a
    // cross-account reference registered cleanly and then failed every
    // resolution as `unavailable` with nothing naming the cause.
    assert.equal(validateRequest(baseBody({ delegations: [arn] })).error, "no_delegations");
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
          {
          guildId: "11111111111111111",
          secretRef: "secret://vrdex/vrclinking/11111111111111111",
        },
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

  // The deployed Lambda has an AWS client and no secret directory. Reading
  // `secret://` as file-only there made every community that registered the
  // named form — the form `/account/connections` and the guild-binding check
  // both accept — permanently unresolvable, surfacing as a 503 rather than as a
  // configuration error anyone would think to look at.
  it("resolves a named reference through Secrets Manager when no secret directory is configured", async () => {
    const asked = [];
    const resolve = createSecretResolver({
      awsClient: {
        getSecretValue: async (secretId) => {
          asked.push(secretId);
          return { SecretString: "provider-token" };
        },
      },
    });

    assert.equal(await resolve("secret://vrdex/vrclinking/123456789012345678"), "provider-token");
    assert.deepEqual(asked, ["vrdex/vrclinking/123456789012345678"]);
  });

  it("still refuses a named reference when neither backend is configured", async () => {
    const resolve = createSecretResolver({});

    await assert.rejects(() => resolve("secret://vrdex/vrclinking/123456789012345678"), {
      reason: "unsupported_reference",
    });
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
  // Our page cap is not the provider's. Reading it as "no match" tells a
  // claimant whose id sits past page five that they are not linked.
  it("reports an incomplete search when the page cap is reached", async () => {
    const get = createVrclinkingClient({
      baseUrl: "https://provider.test/api",
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          totalPages: 40,
          results: [{ id: "999999999999999999", vrcId: OTHER_VRC_ID, isVerified: true }],
        }),
      }),
    });

    await assert.rejects(get("guild", DISCORD_ID, "t"), (error) => {
      assert.ok(error instanceof VrclinkingProviderError);
      assert.equal(error.reason, "search_incomplete");
      return true;
    });
  });

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
