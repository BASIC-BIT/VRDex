import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  requireHostedSmokeFixture,
  requirePreviewClientCredentialsBridge,
  requirePreviewPersistenceBridge,
} from "../../convex/_previewPersistence";

describe("preview persistence and hosted fixture guards", () => {
  it("accepts only an explicitly enabled preview bridge with a matching secret", () => {
    const environment = {
      VRDEX_DEPLOYMENT_ENV: "preview",
      VRDEX_ENABLE_PREVIEW_PERSISTENCE_BRIDGE: "true",
      VRDEX_PREVIEW_PERSISTENCE_SECRET: "preview-secret",
    };

    assert.doesNotThrow(() => requirePreviewPersistenceBridge("preview-secret", environment));
    assert.throws(
      () => requirePreviewPersistenceBridge("wrong-secret", environment),
      /Preview OAuth persistence bridge is unavailable/,
    );
    assert.throws(
      () => requirePreviewPersistenceBridge("preview-secret", { ...environment, VRDEX_DEPLOYMENT_ENV: "production" }),
      /Preview OAuth persistence bridge is unavailable/,
    );
    assert.throws(
      () =>
        requirePreviewPersistenceBridge("preview-secret", {
          ...environment,
          VRDEX_ENABLE_PREVIEW_PERSISTENCE_BRIDGE: "false",
        }),
      /Preview OAuth persistence bridge is unavailable/,
    );
  });

  it("adds a separate capability gate for preview client-credentials issuance", () => {
    const environment = {
      VRDEX_DEPLOYMENT_ENV: "preview",
      VRDEX_ENABLE_PREVIEW_PERSISTENCE_BRIDGE: "true",
      VRDEX_ENABLE_PREVIEW_OAUTH_TOKEN_BRIDGE: "true",
      VRDEX_PREVIEW_PERSISTENCE_SECRET: "preview-secret",
    };

    assert.doesNotThrow(() =>
      requirePreviewClientCredentialsBridge("preview-secret", environment),
    );
    assert.throws(
      () =>
        requirePreviewClientCredentialsBridge("preview-secret", {
          ...environment,
          VRDEX_ENABLE_PREVIEW_OAUTH_TOKEN_BRIDGE: "false",
        }),
      /Preview OAuth client-credentials bridge is unavailable/,
    );
    assert.throws(
      () => requirePreviewClientCredentialsBridge("wrong-secret", environment),
      /Preview OAuth client-credentials bridge is unavailable/,
    );
    assert.throws(
      () =>
        requirePreviewClientCredentialsBridge("preview-secret", {
          ...environment,
          VRDEX_DEPLOYMENT_ENV: "production",
        }),
      /Preview OAuth client-credentials bridge is unavailable/,
    );
  });

  it("allows hosted smoke fixtures only in explicitly enabled preview or staging deployments", () => {
    for (const deploymentEnvironment of ["preview", "staging"]) {
      assert.doesNotThrow(() =>
        requireHostedSmokeFixture({
          VRDEX_DEPLOYMENT_ENV: deploymentEnvironment,
          VRDEX_ENABLE_HOSTED_SMOKE_FIXTURE: "true",
        }),
      );
    }

    for (const deploymentEnvironment of ["development", "production", undefined]) {
      assert.throws(
        () =>
          requireHostedSmokeFixture({
            VRDEX_DEPLOYMENT_ENV: deploymentEnvironment,
            VRDEX_ENABLE_HOSTED_SMOKE_FIXTURE: "true",
          }),
        /Hosted smoke fixtures are unavailable/,
      );
    }
  });
});
