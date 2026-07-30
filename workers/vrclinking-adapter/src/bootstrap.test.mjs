import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resolveAdapterDeps } from "./bootstrap.mjs";

const OWNED = [
  "VRDEX_VRCLINKING_ENABLE_AWS_SECRETS",
  "VRDEX_VRCLINKING_SECRET_DIR",
  "VRDEX_VRCLINKING_BEARER_SECRET_ARN",
  "VRDEX_VRCLINKING_CAPABILITY_SECRET_ARN",
  "VRCHAT_PROOF_ADAPTER_BEARER_TOKEN",
  "VRDEX_VRCLINKING_CAPABILITY_KEY",
];

afterEach(() => {
  for (const name of OWNED) delete process.env[name];
});

describe("adapter bootstrap", () => {
  // The capability signature is only worth anything while its key is unknown to
  // whoever holds the bearer token. Pointed at one value, a leaked token is also
  // the HMAC key — its holder can mint capabilities for guessed guild ids and
  // spend every delegated credential the role can reach. Startup is the only
  // place that is catchable; by request time the two are indistinguishable.
  it("refuses to start when the bearer token and capability key match", async () => {
    process.env.VRDEX_VRCLINKING_SECRET_DIR = "/tmp/vrclinking-secrets";
    process.env.VRCHAT_PROOF_ADAPTER_BEARER_TOKEN = "same-value";
    process.env.VRDEX_VRCLINKING_CAPABILITY_KEY = "same-value";

    await assert.rejects(resolveAdapterDeps, /must be different values/i);
  });

  it("starts when they differ", async () => {
    process.env.VRDEX_VRCLINKING_SECRET_DIR = "/tmp/vrclinking-secrets";
    process.env.VRCHAT_PROOF_ADAPTER_BEARER_TOKEN = "bearer-value";
    process.env.VRDEX_VRCLINKING_CAPABILITY_KEY = "capability-value";

    const deps = await resolveAdapterDeps();

    assert.equal(deps.bearerToken, "bearer-value");
    assert.equal(process.env.VRDEX_VRCLINKING_CAPABILITY_KEY, "capability-value");
  });
});
