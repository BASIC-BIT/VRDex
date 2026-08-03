import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VrchatOperatorLogin } from "./vrchat-login.mjs";

const USER_ID = "usr_11111111-2222-3333-4444-555555555555";
const SESSION = {
  userId: USER_ID,
  authCookie: "auth-cookie-value",
  twoFactorAuthCookie: "two-factor-cookie-value",
};

function loginWith(setCookie) {
  return new VrchatOperatorLogin({
    userAgent: "VRDex/test (ops@example.test)",
    expectedUserId: USER_ID,
    fetcher: async () =>
      new Response(JSON.stringify({ id: USER_ID }), {
        status: 200,
        headers: [
          ["content-type", "application/json"],
          ...setCookie.map((value) => ["set-cookie", value]),
        ],
      }),
  });
}

describe("VRChat session validation", () => {
  it("applies a rotated cookie", async () => {
    const refreshed = await loginWith(["auth=rotated-auth-value; Path=/"]).validateSession(SESSION);

    assert.equal(refreshed.authCookie, "rotated-auth-value");
    assert.equal(refreshed.twoFactorAuthCookie, "two-factor-cookie-value");
  });

  // The provider clearing a cookie is an instruction. Keeping the previous
  // value meant the transfer wrote a retired two-factor cookie into Secrets
  // Manager, where every collector restart would send it.
  it("drops a cookie the provider cleared", async () => {
    for (const cleared of [
      "twoFactorAuth=; Path=/",
      "twoFactorAuth=stale; Max-Age=0; Path=/",
      "twoFactorAuth=stale; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/",
    ]) {
      const refreshed = await loginWith([cleared]).validateSession(SESSION);

      assert.equal(refreshed.twoFactorAuthCookie, undefined, cleared);
      assert.equal(refreshed.authCookie, "auth-cookie-value", cleared);
    }
  });
});
