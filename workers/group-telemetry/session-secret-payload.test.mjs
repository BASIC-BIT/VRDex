import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSessionSecretPayload,
  preservedSecretKeys,
  sessionSecretFields,
} from "./session-secret-payload.mjs";

const KEY = "k".repeat(48);
const AUTH = "authcookievalue";
const TWO_FACTOR = "twofactorcookievalue";
const USER_ID = "usr_11111111-2222-3333-4444-555555555555";

describe("session secret payload", () => {
  it("replaces only the session fields and preserves everything else", () => {
    const existing = {
      workerApiKey: "old-key-old-key-old-key-old-key-old",
      authCookie: "old-auth-cookie",
      operatorNote: "keep me",
      rotationOwner: "ops@example.test",
    };
    const next = buildSessionSecretPayload(existing, {
      workerApiKey: KEY,
      authCookie: AUTH,
      twoFactorAuthCookie: TWO_FACTOR,
      vrchatUserId: USER_ID,
    });

    assert.equal(next.workerApiKey, KEY);
    assert.equal(next.authCookie, AUTH);
    assert.equal(next.twoFactorAuthCookie, TWO_FACTOR);
    assert.equal(next.operatorNote, "keep me");
    assert.equal(next.rotationOwner, "ops@example.test");
    assert.deepEqual(preservedSecretKeys(existing), ["operatorNote", "rotationOwner"]);
  });

  // A left-behind cookie from a previous account would be sent alongside the
  // new session and could authenticate as the wrong identity.
  it("clears a stale two-factor cookie when the new session has none", () => {
    const next = buildSessionSecretPayload(
      { twoFactorAuthCookie: "stale-cookie-value", other: 1 },
      { workerApiKey: KEY, authCookie: AUTH, vrchatUserId: USER_ID },
    );

    assert.equal("twoFactorAuthCookie" in next, false);
    assert.equal(next.other, 1);
  });

  it("handles an absent or malformed existing secret", () => {
    for (const existing of [undefined, null, "not-json", []]) {
      const next = buildSessionSecretPayload(existing, { workerApiKey: KEY, authCookie: AUTH, vrchatUserId: USER_ID });
      assert.equal(next.workerApiKey, KEY);
      assert.deepEqual(preservedSecretKeys(existing), []);
    }
  });

  it("refuses a short worker key or malformed auth cookie", () => {
    assert.throws(
      () => buildSessionSecretPayload({}, { workerApiKey: "short", authCookie: AUTH, vrchatUserId: USER_ID }),
      /at least 32/,
    );
    assert.throws(
      () => buildSessionSecretPayload({}, { workerApiKey: KEY, authCookie: "x" }),
      /malformed/,
    );
  });

  it("names exactly the fields the runbook allows", () => {
    assert.deepEqual(sessionSecretFields(), [
      "workerApiKey",
      "authCookie",
      "twoFactorAuthCookie",
      "vrchatUserId",
    ]);
  });

  // The recorded identity is what catches an alias paired with another
  // account's secret id, so it cannot be optional.
  it("requires the VRChat user id", () => {
    assert.throws(
      () => buildSessionSecretPayload({}, { workerApiKey: KEY, authCookie: AUTH }),
      /vrchatUserId is required/,
    );
  });
});
