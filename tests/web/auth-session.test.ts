import assert from "node:assert/strict";
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
  AUTH_SESSION_TOTAL_DURATION_MS,
  authLifecycleEvent,
  authSessionValidityAt,
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
    assert.deepEqual(authLifecycleEvent("restoring", "authenticated"), {
      event: "auth_session_restore_completed",
      properties: { outcome: "authenticated" },
    });
    assert.equal(
      authLifecycleEvent("authenticated", "authenticated"),
      null,
    );
    assert.deepEqual(authLifecycleEvent("authenticated", "anonymous"), {
      event: "auth_session_state_changed",
      properties: {
        from: "authenticated",
        to: "anonymous",
      },
    });
  });
});
