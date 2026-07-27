import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  AUTH_SESSION_INVALID_CODE,
  invalidAuthSessionRedirectPath,
  invalidAuthSessionRedirectResponse,
  invalidAuthSessionResponse,
  isAuthSessionInvalidError,
} from "../../apps/web/src/lib/server/invalid-auth-session";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function source(path: string) {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

function assertAuthCookiesExpired(response: Response) {
  const cookies = response.headers.getSetCookie();

  assert.equal(cookies.length, 4);

  for (const cookie of cookies) {
    assert.match(cookie, /Max-Age=0/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
  }

  assert.ok(
    cookies.some((cookie) => cookie.startsWith("__convexAuthJWT=")),
  );
  assert.ok(
    cookies.some((cookie) =>
      cookie.startsWith("__convexAuthRefreshToken="),
    ),
  );
  assert.ok(
    cookies.some((cookie) =>
      cookie.startsWith("__Host-__convexAuthJWT=") &&
      cookie.includes("Secure"),
    ),
  );
  assert.ok(
    cookies.some((cookie) =>
      cookie.startsWith("__Host-__convexAuthRefreshToken=") &&
      cookie.includes("Secure"),
    ),
  );
}

describe("invalid browser auth-session recovery", () => {
  it("recognizes only the structured invalid-session error", () => {
    assert.equal(
      isAuthSessionInvalidError({
        data: { code: AUTH_SESSION_INVALID_CODE, reason: "missing" },
      }),
      true,
    );
    assert.equal(
      isAuthSessionInvalidError(new Error(AUTH_SESSION_INVALID_CODE)),
      false,
    );
  });

  it("returns a structured no-store 401 and expires stale auth cookies", async () => {
    const response = invalidAuthSessionResponse("/developers/tokens");

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), {
      code: AUTH_SESSION_INVALID_CODE,
      detail: "Sign in to continue.",
      signInUrl: "/sign-in?returnTo=%2Fdevelopers%2Ftokens",
      status: 401,
      title: "Sign in required",
      type: "about:blank",
    });
    assertAuthCookiesExpired(response);
  });

  it("clears revoked cookies before redirecting through a safe return path", () => {
    assert.equal(
      invalidAuthSessionRedirectPath(
        "/oauth/authorize/review?transaction=valid-token",
      ),
      "/auth/session-invalid?returnTo=%2Foauth%2Fauthorize%2Freview%3Ftransaction%3Dvalid-token",
    );
    assert.equal(
      invalidAuthSessionRedirectPath("https://attacker.invalid"),
      "/auth/session-invalid?returnTo=%2Faccount",
    );

    const response = invalidAuthSessionRedirectResponse(
      new Request(
        "https://app.example.test/auth/session-invalid?returnTo=%2Foauth%2Fauthorize%2Freview%3Ftransaction%3Dvalid-token",
      ),
    );

    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get("location"),
      "https://app.example.test/sign-in?returnTo=%2Foauth%2Fauthorize%2Freview%3Ftransaction%3Dvalid-token",
    );
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assertAuthCookiesExpired(response);
  });

  it("keeps all affected server surfaces on the same structured recovery path", () => {
    const tokens = source(
      "apps/web/src/app/api/developer/tokens/route.ts",
    );
    const oauthApps = source(
      "apps/web/src/app/api/developer/oauth-apps/route.ts",
    );
    const review = source(
      "apps/web/src/app/oauth/authorize/review/page.tsx",
    );
    const recoveryRoute = source(
      "apps/web/src/app/auth/session-invalid/route.ts",
    );

    assert.match(tokens, /isAuthSessionInvalidError\(error\)/);
    assert.match(
      tokens,
      /invalidAuthSessionResponse\("\/developers\/tokens"\)/,
    );
    assert.match(oauthApps, /isAuthSessionInvalidError\(error\)/);
    assert.match(
      oauthApps,
      /invalidAuthSessionResponse\("\/developers\/apps"\)/,
    );
    assert.match(review, /isAuthSessionInvalidError\(error\)/);
    assert.match(review, /invalidAuthSessionRedirectPath/);
    assert.match(recoveryRoute, /invalidAuthSessionRedirectResponse/);
  });
});
