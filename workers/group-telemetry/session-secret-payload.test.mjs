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
      { workerApiKey: KEY, authCookie: AUTH },
    );

    assert.equal("twoFactorAuthCookie" in next, false);
    assert.equal(next.other, 1);
  });

  it("handles an absent or malformed existing secret", () => {
    for (const existing of [undefined, null, "not-json", []]) {
      const next = buildSessionSecretPayload(existing, { workerApiKey: KEY, authCookie: AUTH });
      assert.equal(next.workerApiKey, KEY);
      assert.deepEqual(preservedSecretKeys(existing), []);
    }
  });

  it("refuses a short worker key or malformed auth cookie", () => {
    assert.throws(
      () => buildSessionSecretPayload({}, { workerApiKey: "short", authCookie: AUTH }),
      /at least 32/,
    );
    assert.throws(
      () => buildSessionSecretPayload({}, { workerApiKey: KEY, authCookie: "x" }),
      /malformed/,
    );
  });

  it("names exactly the three fields the runbook allows", () => {
    assert.deepEqual(sessionSecretFields(), [
      "workerApiKey",
      "authCookie",
      "twoFactorAuthCookie",
    ]);
  });
});
