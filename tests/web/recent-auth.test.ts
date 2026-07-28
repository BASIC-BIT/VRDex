import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";

import {
  RECENT_AUTH_REQUIRED_CODE,
  isReauthenticationRequest,
  isRecentAuthRequiredError,
  recentAuthActionClassForReturnTo,
  recentAuthProviderAllowed,
  reauthenticationCompletionPath,
  reauthenticationFinishPath,
  reauthenticationPath,
  recentAuthRequiredResponse,
  saveRecentAuthDraft,
  takeRecentAuthDraft,
  validRecentAuthChallengeId,
} from "../../apps/web/src/lib/recent-auth";
import {
  RECENT_AUTH_BINDING_COOKIE,
  RECENT_AUTH_BINDING_MAX_AGE_MS,
  clearRecentAuthBindingCookie,
  decodeRecentAuthFinishProof,
  encodeRecentAuthBinding,
  encodeRecentAuthFinishProof,
  recentAuthBindingDecision,
  recentAuthFinishCookieIsSecure,
  setRecentAuthBindingCookie,
} from "../../apps/web/src/lib/server/recent-auth-binding";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const CHALLENGE_ID = "0123456789abcdef0123456789abcdef";

function source(path: string) {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

describe("recent authentication web contract", () => {
  it("builds a same-origin reauthentication path", () => {
    assert.equal(
      reauthenticationPath("/developers/tokens?source=account"),
      "/auth/reauth/start?returnTo=%2Fdevelopers%2Ftokens%3Fsource%3Daccount",
    );
    assert.equal(
      reauthenticationPath("https://attacker.invalid"),
      "/auth/reauth/start?returnTo=%2Faccount",
    );
  });

  it("enables reauthentication only for the explicit query value", () => {
    assert.equal(isReauthenticationRequest("1"), true);
    assert.equal(isReauthenticationRequest(["1", "0"]), true);
    assert.equal(isReauthenticationRequest("true"), false);
    assert.equal(isReauthenticationRequest(undefined), false);
  });

  it("uses a safe provider completion route and fixed action classes", () => {
    assert.equal(
      reauthenticationCompletionPath("/developers/apps", CHALLENGE_ID),
      `/auth/reauth/complete?returnTo=%2Fdevelopers%2Fapps&challenge=${CHALLENGE_ID}`,
    );
    assert.equal(
      reauthenticationCompletionPath(
        "https://attacker.invalid",
        CHALLENGE_ID,
      ),
      `/auth/reauth/complete?returnTo=%2Faccount&challenge=${CHALLENGE_ID}`,
    );
    assert.equal(validRecentAuthChallengeId(CHALLENGE_ID), CHALLENGE_ID);
    assert.equal(validRecentAuthChallengeId("not-a-challenge"), null);
    assert.equal(
      reauthenticationFinishPath(
        "/developers/apps",
        CHALLENGE_ID,
      ),
      `/auth/reauth/finish?returnTo=%2Fdevelopers%2Fapps&challenge=${CHALLENGE_ID}`,
    );
    assert.equal(
      recentAuthActionClassForReturnTo("/developers/apps"),
      "developer_oauth_application",
    );
    assert.equal(
      recentAuthActionClassForReturnTo("/account/security"),
      "session_revocation",
    );
    assert.equal(
      recentAuthActionClassForReturnTo("/developers/tokens"),
      "developer_token",
    );
  });

  it("recognizes only the structured recent-auth error", () => {
    assert.equal(
      isRecentAuthRequiredError({
        data: { code: RECENT_AUTH_REQUIRED_CODE },
      }),
      true,
    );
    assert.equal(
      isRecentAuthRequiredError(new Error(RECENT_AUTH_REQUIRED_CODE)),
      false,
    );
  });

  it("returns a no-store challenge without identifiers", async () => {
    const response = recentAuthRequiredResponse("/developers/apps");
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(body, {
      code: RECENT_AUTH_REQUIRED_CODE,
      detail: "Sign in again to continue.",
      reauthUrl:
        "/auth/reauth/start?returnTo=%2Fdevelopers%2Fapps",
      status: 401,
      title: "Sign in again",
      type: "about:blank",
    });
  });

  it("binds completion to the server-derived principal and fails closed", () => {
    const now = Date.UTC(2026, 6, 27, 12);
    const binding = encodeRecentAuthBinding({
      actionClass: "session_revocation",
      challengeId: CHALLENGE_ID,
      issuedAt: now,
      originalSessionId: "session-original",
      userId: "user-original",
    });

    assert.equal(
      recentAuthBindingDecision({
        binding,
        challengeId: CHALLENGE_ID,
        currentUserId: "user-original",
        now,
      }),
      "match",
    );
    assert.equal(
      recentAuthBindingDecision({
        binding,
        challengeId: CHALLENGE_ID,
        currentUserId: "user-different",
        now,
      }),
      "mismatch",
    );
    assert.equal(
      recentAuthBindingDecision({
        binding,
        challengeId: CHALLENGE_ID,
        currentUserId: "user-original",
        now: now + RECENT_AUTH_BINDING_MAX_AGE_MS + 1,
      }),
      "missing",
    );
    assert.equal(
      recentAuthBindingDecision({
        binding: null,
        challengeId: CHALLENGE_ID,
        currentUserId: "user-original",
        now,
      }),
      "missing",
    );
  });

  it("sets and clears a short-lived host-only binding cookie", () => {
    const request = new Request(
      "https://vrdex.net/auth/reauth/start?returnTo=%2Faccount",
    );
    const response = setRecentAuthBindingCookie(
      new Response(null, { status: 303 }),
      request,
      {
        actionClass: "session_revocation",
        challengeId: CHALLENGE_ID,
        issuedAt: Date.UTC(2026, 6, 27, 12),
        originalSessionId: "session-original",
        userId: "user-original",
      },
    );
    const setCookie = response.headers.get("set-cookie") ?? "";

    assert.match(
      setCookie,
      new RegExp(`^${RECENT_AUTH_BINDING_COOKIE}-${CHALLENGE_ID}=`),
    );
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /Max-Age=600/);
    assert.doesNotMatch(setCookie, /Domain=/i);

    const cleared = clearRecentAuthBindingCookie(
      new Response(null, { status: 303 }),
      request,
      CHALLENGE_ID,
    );
    assert.match(cleared.headers.get("set-cookie") ?? "", /Max-Age=0/);
  });

  it("offers only providers that can prove fresh authentication for step-up", () => {
    assert.equal(recentAuthProviderAllowed("password"), true);
    assert.equal(recentAuthProviderAllowed("google"), false);
    assert.equal(recentAuthProviderAllowed("discord"), false);
  });

  it("requires a short-lived challenge-bound proof before finish telemetry", () => {
    const now = Date.now();
    const proof = {
      actionClass: "session_revocation" as const,
      challengeId: CHALLENGE_ID,
      issuedAt: now,
    };

    assert.deepEqual(
      decodeRecentAuthFinishProof(
        encodeRecentAuthFinishProof(proof),
        CHALLENGE_ID,
        now,
      ),
      proof,
    );
    assert.equal(
      decodeRecentAuthFinishProof(
        encodeRecentAuthFinishProof(proof),
        "fedcba9876543210fedcba9876543210",
        now,
      ),
      null,
    );
    assert.equal(
      decodeRecentAuthFinishProof(
        encodeRecentAuthFinishProof(proof),
        CHALLENGE_ID,
        now + 60_001,
      ),
      null,
    );
    assert.equal(
      recentAuthFinishCookieIsSecure("vrdex.net", "https"),
      true,
    );
    assert.equal(
      recentAuthFinishCookieIsSecure("vrdex.net", null),
      true,
    );
    assert.equal(
      recentAuthFinishCookieIsSecure("127.0.0.1:3002", "http"),
      false,
    );
    assert.equal(
      recentAuthFinishCookieIsSecure("localhost:3002", null),
      false,
    );
  });

  it("routes principal binding and mismatch cleanup through server handlers", () => {
    const startRoute = source(
      "apps/web/src/app/auth/reauth/start/route.ts",
    );
    const completionRoute = source(
      "apps/web/src/app/auth/reauth/complete/route.ts",
    );
    const finishClient = source(
      "apps/web/src/app/auth/reauth/finish/reauth-finish-client.tsx",
    );
    const finishPage = source(
      "apps/web/src/app/auth/reauth/finish/page.tsx",
    );
    const cancelRoute = source(
      "apps/web/src/app/auth/reauth/cancel/route.ts",
    );
    const failRoute = source(
      "apps/web/src/app/auth/reauth/fail/route.ts",
    );
    const convergenceRoute = source(
      "apps/web/src/app/auth/session-converge/route.ts",
    );
    const challengeBackend = source(
      "convex/recentAuthChallenges.ts",
    );
    const crons = source("convex/crons.ts");
    const clientProvider = source(
      "apps/web/src/app/ConvexClientProvider.tsx",
    );
    const middleware = source("apps/web/src/middleware.ts");

    assert.match(startRoute, /beginRecentAuthChallengeMutation/);
    assert.match(startRoute, /crypto\.randomUUID/);
    assert.match(startRoute, /setRecentAuthBindingCookie/);
    assert.match(startRoute, /location: path/);
    assert.doesNotMatch(startRoute, /new URL\(path, request\.url\)/);
    assert.match(completionRoute, /recentAuthBindingDecision/);
    assert.doesNotMatch(completionRoute, /revokeAuthSessionMutation/);
    assert.match(completionRoute, /completeRecentAuthChallengeMutation/);
    assert.match(
      completionRoute,
      /const clearAuth = completion\.clearAuth/,
    );
    assert.doesNotMatch(
      completionRoute,
      /decision === "mismatch"/,
    );
    assert.doesNotMatch(
      completionRoute,
      /binding\.originalSessionId !== currentSessionId/,
    );
    assert.match(completionRoute, /reauthenticationFinishPath/);
    assert.match(
      finishClient,
      /recent_auth_challenge_completed/,
    );
    assert.match(finishClient, /outcome:\s*"completed"/);
    assert.match(finishClient, /\$insert_id/);
    assert.match(finishClient, /reauthenticationFinishClearPath/);
    assert.match(finishPage, /decodeRecentAuthFinishProof/);
    assert.match(finishPage, /recentAuthFinishCookieIsSecure/);
    assert.match(finishPage, /if \(proof === null\)/);
    assert.match(cancelRoute, /cancelRecentAuthChallengeMutation/);
    assert.match(cancelRoute, /clearRecentAuthBindingCookie/);
    assert.match(failRoute, /failRecentAuthChallengeMutation/);
    assert.match(failRoute, /expireAuthSessionCookies/);
    assert.match(failRoute, /clearRecentAuthBindingCookie/);
    assert.match(failRoute, /try \{\s*authToken = await convexAuthNextjsToken/);
    assert.doesNotMatch(completionRoute, /session-converge/);
    assert.match(
      challengeBackend,
      /export const expireAbandoned = internalMutation/,
    );
    assert.match(challengeBackend, /\.withIndex\("by_expiresAt"/);
    assert.match(
      crons,
      /expire abandoned recent authentication challenges/,
    );
    assert.match(clientProvider, /\/auth\/session-converge/);
    assert.match(convergenceRoute, /activeAuthSessionViewerQuery/);
    assert.match(convergenceRoute, /if \(viewer === null\)/);
    assert.match(convergenceRoute, /expireAuthSessionCookies/);
    assert.match(completionRoute, /expireAuthSessionCookies/);
    assert.match(completionRoute, /clearRecentAuthBindingCookie/);
    assert.match(completionRoute, /location: path/);
    assert.doesNotMatch(completionRoute, /new URL\(path, request\.url\)/);
    assert.match(
      middleware,
      /pathname === "\/auth\/reauth\/complete"[\s\S]*NextResponse\.next/,
    );
  });

  it("preserves bounded non-secret drafts without replaying writes", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => void values.delete(key),
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    assert.equal(
      saveRecentAuthDraft(storage, "developer_token", {
        label: "Local MCP",
        scopes: ["public:read"],
      }),
      true,
    );
    assert.deepEqual(takeRecentAuthDraft(storage, "developer_token"), {
      label: "Local MCP",
      scopes: ["public:read"],
    });
    assert.equal(takeRecentAuthDraft(storage, "developer_token"), null);
    const throwingStorage = {
      getItem: () => {
        throw new DOMException("Storage denied.", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("Storage denied.", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("Storage denied.", "SecurityError");
      },
    };
    assert.equal(
      saveRecentAuthDraft(throwingStorage, "developer_token", {
        label: "Local MCP",
      }),
      false,
    );
    assert.equal(
      takeRecentAuthDraft(throwingStorage, "developer_token"),
      null,
    );
    assert.equal(saveRecentAuthDraft(null, "developer_token", {}), false);
    assert.equal(takeRecentAuthDraft(null, "developer_token"), null);

    const signInForm = source("apps/web/src/app/sign-in/sign-in-form.tsx");
    const tokensPanel = source(
      "apps/web/src/app/developers/tokens/developer-tokens-panel.tsx",
    );
    const appsPanel = source(
      "apps/web/src/app/developers/apps/oauth-apps-panel.tsx",
    );

    assert.match(
      signInForm,
      /signIn\("password-reauth"/,
    );
    assert.match(
      signInForm,
      /proof: verification\.proof/,
    );
    assert.match(signInForm, /\{!reauthenticate \? \(\s*<Button[\s\S]*Create account/);
    assert.doesNotMatch(
      signInForm,
      /outcome:\s*"completed"/,
    );
    assert.match(signInForm, />\s*Cancel\s*<\/Button>/);
    assert.match(
      signInForm,
      /fetch\("\/auth\/reauth\/complete"/,
    );
    assert.match(tokensPanel, /router\.push\(body\.reauthUrl\)/);
    assert.match(appsPanel, /router\.push\(body\.reauthUrl\)/);
    assert.match(tokensPanel, /saveRecentAuthDraft/);
    assert.match(tokensPanel, /temporalAccess === undefined/);
    assert.match(tokensPanel, /\[temporalAccess, tokens\]/);
    assert.match(appsPanel, /saveRecentAuthDraft/);
    assert.doesNotMatch(tokensPanel, /localStorage/);
    assert.doesNotMatch(appsPanel, /localStorage/);
  });
});
