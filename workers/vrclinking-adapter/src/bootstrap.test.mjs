import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resolveAdapterDeps } from "./bootstrap.mjs";

const OWNED = [
  "VRDEX_VRCLINKING_ENABLE_AWS_SECRETS",
  "VRDEX_VRCLINKING_SECRET_DIR",
  "VRDEX_VRCLINKING_SHARED_SECRET_ARN",
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

  // One object, so the pair cannot be read mid-write. Two secrets could not be
  // written atomically: a cold start between the writes cached a new bearer
  // against an old capability key and held it for the container's life.
  it("reads both values from one JSON secret", async () => {
    process.env.VRDEX_VRCLINKING_SECRET_DIR = "/tmp/vrclinking-secrets";
    process.env.VRDEX_VRCLINKING_SHARED_SECRET_ARN =
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:vrdex/vrclinking/shared-AbCdEf";
    process.env.VRDEX_VRCLINKING_ENABLE_AWS_SECRETS = "true";

    const asked = [];
    const deps = await resolveAdapterDeps({
      awsClient: {
        getSecretValue: async (secretId) => {
          asked.push(secretId);
          return {
            SecretString: JSON.stringify({
              bearerToken: "from-json-bearer",
              capabilityKey: "from-json-capability",
            }),
          };
        },
      },
    });

    assert.equal(asked.length, 1, "one read, not one per value");
    assert.equal(deps.bearerToken, "from-json-bearer");
    assert.equal(process.env.VRDEX_VRCLINKING_CAPABILITY_KEY, "from-json-capability");
  });

  it("refuses a shared secret missing either field", async () => {
    process.env.VRDEX_VRCLINKING_SECRET_DIR = "/tmp/vrclinking-secrets";
    process.env.VRDEX_VRCLINKING_SHARED_SECRET_ARN =
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:vrdex/vrclinking/shared-AbCdEf";
    process.env.VRDEX_VRCLINKING_ENABLE_AWS_SECRETS = "true";

    for (const payload of ["not json", '{"bearerToken":"only-one"}', "{}"]) {
      await assert.rejects(
        () =>
          resolveAdapterDeps({
            awsClient: { getSecretValue: async () => ({ SecretString: payload }) },
          }),
        /shared secret/i,
        payload,
      );
    }
  });
});
