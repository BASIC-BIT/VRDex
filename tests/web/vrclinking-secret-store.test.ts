import assert from "node:assert/strict";
import test from "node:test";

import {
  isVrclinkingSecretStoreConfigured,
  putVrclinkingDelegationKey,
} from "../../apps/web/src/lib/server/vrclinking-secret-store";

const KEYS = [
  "VRDEX_VRCLINKING_SECRET_REGION",
  "VRDEX_VRCLINKING_DELEGATION_ROLE_ARN",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
] as const;

function withEnv(values: Partial<Record<(typeof KEYS)[number], string>>, run: () => void) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

  try {
    for (const key of KEYS) {
      const value = values[key];

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    run();
  } finally {
    for (const key of KEYS) {
      const value = saved[key];

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

/**
 * The whole point of the gate: the delegation form asks whether a key can be
 * stored *before* offering the field, because the alternative is telling an
 * owner their key was saved when nothing holds it.
 */
test("needs both a region and a role before it will accept a key", () => {
  withEnv({}, () => {
    assert.equal(isVrclinkingSecretStoreConfigured(), false);
  });

  withEnv({ VRDEX_VRCLINKING_SECRET_REGION: "us-east-1" }, () => {
    assert.equal(isVrclinkingSecretStoreConfigured(), false);
  });

  withEnv({ VRDEX_VRCLINKING_DELEGATION_ROLE_ARN: "arn:aws:iam::1:role/x" }, () => {
    assert.equal(isVrclinkingSecretStoreConfigured(), false);
  });

  withEnv(
    {
      VRDEX_VRCLINKING_SECRET_REGION: "us-east-1",
      VRDEX_VRCLINKING_DELEGATION_ROLE_ARN: "arn:aws:iam::1:role/x",
    },
    () => {
      assert.equal(isVrclinkingSecretStoreConfigured(), true);
    },
  );
});

/**
 * Vercel's runtime sets `AWS_REGION` to wherever the function happens to run,
 * which has nothing to do with where delegated secrets live. Falling back to it
 * would report every deployment as configured and then write each community's
 * key into whichever region served the request — a different store from the one
 * the adapter reads, so the delegation would register, report success, and
 * resolve to nothing forever.
 */
test("ignores the ambient AWS region", () => {
  withEnv(
    {
      AWS_REGION: "eu-west-1",
      AWS_DEFAULT_REGION: "eu-west-1",
      VRDEX_VRCLINKING_DELEGATION_ROLE_ARN: "arn:aws:iam::1:role/x",
    },
    () => {
      assert.equal(isVrclinkingSecretStoreConfigured(), false);
    },
  );
});

/**
 * The name comes from Convex's reservation, so this only refuses one that is not
 * the shape everything else agreed on. Two segments matter: `vrdex/vrclinking/
 * <guild>` alone is where `shared` lives — the adapter's own bearer token and
 * capability key — and it is outside both the IAM grant and the adapter's
 * delegation shape. A bug that wrote there would be replacing VRDex's
 * authorization to its own adapter.
 */
test("refuses to write outside the delegated-credential shape", async () => {
  const refused = [
    "vrdex/vrclinking/shared",
    "vrdex/vrclinking/100000000000000001",
    "vrdex/vrclinking/../shared/x",
    "vrdex/collector/100000000000000001/abc",
    "vrdex/vrclinking/not-a-guild/abc",
    "vrdex/vrclinking/100000000000000001/abc/def",
  ];

  for (const name of refused) {
    await assert.rejects(
      () => putVrclinkingDelegationKey(name, "key"),
      /unexpected secret name/,
      name,
    );
  }
});
