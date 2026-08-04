import assert from "node:assert/strict";
import test from "node:test";

import {
  isVrclinkingSecretStoreConfigured,
  vrclinkingSecretName,
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
 * The name the adapter resolves. `vrclinkingSecretName` here, `secretNameForGuild`
 * in `convex/vrclinkingCredentials.ts`, and `isSecretRefForGuild` in the adapter
 * all have to agree, and the IAM grant in
 * `infra/terraform/vrclinking-adapter/delegation-writer.tf` is scoped to the
 * same prefix — a drift in any one of them denies every delegation.
 */
test("writes under the prefix the adapter reads and the grant allows", () => {
  assert.equal(vrclinkingSecretName("100000000000000001"), "vrdex/vrclinking/100000000000000001");
});
