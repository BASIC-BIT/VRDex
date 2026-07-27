import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  AUTH_JWT_DURATION_MS as BACKEND_JWT_DURATION_MS,
  AUTH_SESSION_INACTIVE_DURATION_MS as BACKEND_INACTIVE_DURATION_MS,
  AUTH_SESSION_TOTAL_DURATION_MS as BACKEND_TOTAL_DURATION_MS,
} from "../../convex/_authSession";
import {
  AUTH_JWT_DURATION_MS,
  AUTH_SESSION_COOKIE_MAX_AGE_SECONDS,
  AUTH_SESSION_INACTIVE_DURATION_MS,
  AUTH_SESSION_RESTORE_SLOW_MS,
  AUTH_SESSION_TOTAL_DURATION_MS,
  authLifecycleEvent,
  authSessionCredentialPresent,
  authSessionDiagnosticContext,
  authSessionRestoreLatencyBucket,
  authSessionRestoreSlowEvent,
  authSessionRouteClass,
  authSessionValidityAt,
  nextAuthRevocationConvergenceStarted,
  shouldConvergeRevokedSession,
} from "../../apps/web/src/lib/auth-session";

const DAY_MS = 24 * 60 * 60 * 1_000;

describe("app session contract", () => {
  it("keeps the browser and backend inactivity windows aligned", () => {
    assert.equal(AUTH_JWT_DURATION_MS, 60 * 60 * 1_000);
    assert.equal(AUTH_SESSION_INACTIVE_DURATION_MS, 30 * DAY_MS);
    assert.equal(AUTH_SESSION_TOTAL_DURATION_MS, 90 * DAY_MS);
    assert.equal(
      AUTH_SESSION_COOKIE_MAX_AGE_SECONDS * 1_000,
      AUTH_SESSION_INACTIVE_DURATION_MS,
    );
    assert.equal(BACKEND_JWT_DURATION_MS, AUTH_JWT_DURATION_MS);
    assert.equal(
      BACKEND_INACTIVE_DURATION_MS,
      AUTH_SESSION_INACTIVE_DURATION_MS,
    );
    assert.equal(BACKEND_TOTAL_DURATION_MS, AUTH_SESSION_TOTAL_DURATION_MS);
  });

  it("uses a clock-controlled inactivity boundary", () => {
    const now = Date.UTC(2026, 6, 26);

    assert.equal(
      authSessionValidityAt({
        now,
        sessionExpiresAt: now + 60 * DAY_MS,
        refreshExpiresAt: now + 1,
        refreshCredentialPresent: true,
      }),
      "active",
    );
    assert.equal(
      authSessionValidityAt({
        now: now + 1,
        sessionExpiresAt: now + 60 * DAY_MS,
        refreshExpiresAt: now + 1,
        refreshCredentialPresent: true,
      }),
      "inactive_expired",
    );
  });

  it("enforces the absolute boundary even after recent activity", () => {
    const now = Date.UTC(2026, 6, 26);

    assert.equal(
      authSessionValidityAt({
        now,
        sessionExpiresAt: now,
        refreshExpiresAt: now + 30 * DAY_MS,
        refreshCredentialPresent: true,
      }),
      "absolute_expired",
    );
  });

  it("treats a missing or revoked refresh credential as revoked", () => {
    const now = Date.UTC(2026, 6, 26);

    assert.equal(
      authSessionValidityAt({
        now,
        sessionExpiresAt: now + 90 * DAY_MS,
        refreshExpiresAt: now + 30 * DAY_MS,
        refreshCredentialPresent: false,
      }),
      "revoked",
    );
  });

  it("emits sanitized lifecycle events only after restoration settles", () => {
    assert.equal(authLifecycleEvent(null, "restoring"), null);
    assert.equal(
      authLifecycleEvent("restoring", "anonymous", {
        credentialPresent: false,
      }),
      null,
    );
    assert.deepEqual(authLifecycleEvent("restoring", "authenticated"), {
      event: "auth_session_restore_completed",
      properties: {
        latency_bucket: "under_1s",
        outcome: "authenticated",
        route_class: "public",
      },
    });
    assert.equal(
      authLifecycleEvent("authenticated", "authenticated"),
      null,
    );
    assert.deepEqual(authLifecycleEvent("authenticated", "anonymous"), {
      event: "auth_session_state_changed",
      properties: {
        from: "authenticated",
        intent: "unclassified",
        to: "anonymous",
      },
    });
  });

  it("buckets restoration latency at deterministic boundaries", () => {
    assert.equal(authSessionRestoreLatencyBucket(999), "under_1s");
    assert.equal(authSessionRestoreLatencyBucket(1_000), "under_3s");
    assert.equal(authSessionRestoreLatencyBucket(2_999), "under_3s");
    assert.equal(authSessionRestoreLatencyBucket(3_000), "under_10s");
    assert.equal(
      authSessionRestoreLatencyBucket(AUTH_SESSION_RESTORE_SLOW_MS - 1),
      "under_10s",
    );
    assert.equal(
      authSessionRestoreLatencyBucket(AUTH_SESSION_RESTORE_SLOW_MS),
      "over_10s",
    );
  });

  it("classifies auth routes without capturing paths", () => {
    assert.equal(authSessionRouteClass("/sign-in"), "auth");
    assert.equal(authSessionRouteClass("/verify-email/code"), "auth");
    assert.equal(authSessionRouteClass("/account/security"), "protected");
    assert.equal(authSessionRouteClass("/claim/example"), "protected");
    assert.equal(authSessionRouteClass("/developers/apps"), "protected");
    assert.equal(authSessionRouteClass("/p/example"), "public");
  });

  it("records explicit current-tab sign-out intent without identifiers", () => {
    assert.deepEqual(
      authLifecycleEvent("authenticated", "anonymous", {
        intent: "explicit_signout_current_tab",
      }),
      {
        event: "auth_session_state_changed",
        properties: {
          from: "authenticated",
          intent: "explicit_signout_current_tab",
          to: "anonymous",
        },
      },
    );
  });

  it("re-arms remote revocation convergence after client-side sign-out and sign-in", () => {
    let convergenceStarted = false;

    convergenceStarted = nextAuthRevocationConvergenceStarted(
      convergenceStarted,
      "signout_requested",
    );
    assert.equal(convergenceStarted, true);

    convergenceStarted = nextAuthRevocationConvergenceStarted(
      convergenceStarted,
      "signed_out",
    );
    assert.equal(convergenceStarted, false);

    convergenceStarted = nextAuthRevocationConvergenceStarted(
      convergenceStarted,
      "revocation_detected",
    );
    assert.equal(convergenceStarted, true);
  });

  it("re-arms remote revocation convergence when explicit sign-out fails", () => {
    assert.equal(
      nextAuthRevocationConvergenceStarted(true, "signout_failed"),
      false,
    );
  });

  it("rechecks a revoked session after sign-out failure re-arms convergence", () => {
    const provider = readFileSync(
      new URL(
        "../../apps/web/src/app/ConvexClientProvider.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(provider, /retryConvergence\(\)/);
    assert.match(
      provider,
      /\[\s*activeSessionState,\s*convergenceRetryVersion,/,
    );
  });

  it("distinguishes attempted restoration from ordinary anonymous visits", () => {
    assert.equal(authSessionCredentialPresent([]), false);
    assert.equal(
      authSessionCredentialPresent(["unrelated", "__convexAuthJWT"]),
      true,
    );
    assert.equal(
      authSessionCredentialPresent([
        "__Host-__convexAuthRefreshToken",
      ]),
      true,
    );
    assert.equal(
      authSessionRestoreSlowEvent({
        alreadyEmitted: false,
        credentialPresent: false,
        elapsedMs: AUTH_SESSION_RESTORE_SLOW_MS,
        routeClass: "public",
      }),
      null,
    );
  });

  it("defers remote-revocation convergence while a replacement sign-in is in progress", () => {
    assert.equal(shouldConvergeRevokedSession("auth"), false);
    assert.equal(shouldConvergeRevokedSession("protected"), true);
    assert.equal(shouldConvergeRevokedSession("public"), true);
  });

  it("emits a slow-restore event once at the clock-controlled boundary", () => {
    assert.equal(
      authSessionRestoreSlowEvent({
        alreadyEmitted: false,
        elapsedMs: AUTH_SESSION_RESTORE_SLOW_MS - 1,
        routeClass: "protected",
      }),
      null,
    );
    assert.deepEqual(
      authSessionRestoreSlowEvent({
        alreadyEmitted: false,
        elapsedMs: AUTH_SESSION_RESTORE_SLOW_MS,
        routeClass: "protected",
      }),
      {
        event: "auth_session_restore_slow",
        properties: {
          route_class: "protected",
        },
      },
    );
    assert.equal(
      authSessionRestoreSlowEvent({
        alreadyEmitted: true,
        elapsedMs: AUTH_SESSION_RESTORE_SLOW_MS,
        routeClass: "protected",
      }),
      null,
    );
  });

  it("keeps application-supplied lifecycle properties identifier-free", () => {
    const events = [
      authLifecycleEvent("restoring", "authenticated", {
        restoreDurationMs: 2_000,
        routeClass: "protected",
      }),
      authLifecycleEvent("authenticated", "anonymous"),
      authSessionRestoreSlowEvent({
        alreadyEmitted: false,
        elapsedMs: AUTH_SESSION_RESTORE_SLOW_MS,
        routeClass: "auth",
      }),
    ];
    const serialized = JSON.stringify(events);

    for (const forbidden of [
      "client_secret",
      "email",
      "provider",
      "redirect",
      "refreshToken",
      "sessionId",
      "token",
      "userId",
    ]) {
      assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
    }
  });

  it("classifies deployment, browser, and OS without retaining raw values", () => {
    assert.deepEqual(
      authSessionDiagnosticContext({
        hostname: "staging.vrdex.net",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/141.0",
      }),
      {
        browser_family: "firefox",
        deployment_category: "staging",
        os_family: "windows",
      },
    );
    assert.deepEqual(
      authSessionDiagnosticContext({
        hostname: "vrdex-git-auth.example.vercel.app",
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      }),
      {
        browser_family: "safari",
        deployment_category: "preview",
        os_family: "macos",
      },
    );
  });
});
