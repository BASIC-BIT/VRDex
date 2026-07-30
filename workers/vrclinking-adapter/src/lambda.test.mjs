import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { handleAdapterRequest } from "./handler.mjs";

const BEARER = "bearer-token-for-tests";
const CAPABILITY_KEY = "capability-key-for-tests";
process.env.VRDEX_VRCLINKING_CAPABILITY_KEY = CAPABILITY_KEY;

const GUILD_ID = "123456789012345671";
const DISCORD_ID = "123456789012345678";
const VRC_ID = "usr_11111111-2222-3333-4444-555555555555";
const FAR_FUTURE = Date.UTC(2099, 0, 1);

function signedDelegation() {
  const secretRef = `secret://vrdex/vrclinking/${GUILD_ID}`;

  return {
    guildId: GUILD_ID,
    secretRef,
    expiresAt: FAR_FUTURE,
    capability: createHmac("sha256", CAPABILITY_KEY)
      .update(`${GUILD_ID}\n${secretRef}\n${FAR_FUTURE}`)
      .digest("hex"),
  };
}

function call(overrides = {}) {
  return handleAdapterRequest({
    method: "POST",
    path: "/",
    authorization: `Bearer ${BEARER}`,
    rawBody: JSON.stringify({
      targetType: "vrclinking",
      discordUserId: DISCORD_ID,
      targetExternalId: VRC_ID,
      delegations: [signedDelegation()],
    }),
    bearerToken: BEARER,
    resolveSecret: async () => "provider-token",
    getGuildMemberByDiscordId: async () => ({
      id: DISCORD_ID,
      vrcId: VRC_ID,
      isVerified: true,
    }),
    ...overrides,
  });
}

describe("adapter transport contract", () => {
  it("answers the health check without a bearer token", async () => {
    const result = await handleAdapterRequest({
      method: "GET",
      path: "/healthz",
      bearerToken: BEARER,
    });

    assert.deepEqual(result, { status: 200, payload: { status: "ok" } });
  });

  it("rejects a wrong or missing bearer token before parsing anything", async () => {
    assert.equal((await call({ authorization: "" })).status, 401);
    assert.equal((await call({ authorization: "Bearer wrong" })).status, 401);
  });

  it("returns the match metadata the control plane requires", async () => {
    const { status, payload } = await call();

    assert.equal(status, 200);
    assert.equal(payload.verified, true);
    assert.equal(payload.matchedDelegationIndex, 0);
    assert.deepEqual(payload.consultedDelegationIndexes, [0]);
  });

  // "We could not ask anyone" must never reach the claimant as "we asked and
  // the answer was no", so it travels as a status rather than a body flag.
  it("maps an unconsultable request to 503", async () => {
    const { status, payload } = await call({
      resolveSecret: async () => {
        throw new Error("nope");
      },
    });

    assert.equal(status, 503);
    assert.equal(payload.verified, false);
  });

  // `validateRequest` verifies capabilities and throws without a signing key.
  // Outside the handler's try that killed the process rather than answering.
  it("answers rather than throwing when the signing key is absent", async () => {
    const saved = process.env.VRDEX_VRCLINKING_CAPABILITY_KEY;
    delete process.env.VRDEX_VRCLINKING_CAPABILITY_KEY;

    try {
      assert.equal((await call()).status, 500);
    } finally {
      process.env.VRDEX_VRCLINKING_CAPABILITY_KEY = saved;
    }
  });

  it("refuses a method it does not serve", async () => {
    const result = await handleAdapterRequest({
      method: "DELETE",
      path: "/",
      bearerToken: BEARER,
    });

    assert.equal(result.status, 405);
  });
});
