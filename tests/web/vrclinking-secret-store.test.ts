import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isVrclinkingSecretStoreConfigured,
  putVrclinkingDelegationKey,
  scheduleVrclinkingDelegationKeyDeletion,
} from "../../apps/web/src/lib/server/vrclinking-secret-store";

const KEYS = [
  "VRDEX_VRCLINKING_SECRET_REGION",
  "VRDEX_VRCLINKING_DELEGATION_ROLE_ARN",
  "VRDEX_VRCLINKING_SECRET_DIR",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
] as const;

function withEnv(
  values: Partial<Record<(typeof KEYS)[number], string>>,
  run: () => void | Promise<void>,
) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  const restore = () => {
    for (const key of KEYS) {
      const value = saved[key];

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  for (const key of KEYS) {
    const value = values[key];

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  // Restored after the promise settles when `run` is async, so an awaited
  // assertion still sees the environment it was given.
  try {
    const outcome = run();

    if (outcome instanceof Promise) {
      return outcome.finally(restore);
    }

    restore();

    return undefined;
  } catch (error) {
    restore();

    throw error;
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

/**
 * The adapter documents `VRDEX_VRCLINKING_SECRET_DIR` as its self-hosting
 * backend, and resolving was the only half that existed. Without writing, a
 * file-backed deployment had no way to create a delegation at all once the
 * reference-registration form was removed — the form would hide itself and the
 * route would answer 503.
 */
test("counts a file backend as configured", () => {
  withEnv({ VRDEX_VRCLINKING_SECRET_DIR: "/tmp/vrdex-secrets" }, () => {
    assert.equal(isVrclinkingSecretStoreConfigured(), true);
  });
});

/**
 * A legacy delegation's key is a *file* at exactly the path a per-credential key
 * needs as its directory — the guild-scoped name is one segment shorter. The two
 * schemes cannot share a filesystem, and moving the legacy file aside would
 * break the delegation still resolving through it, so this refuses with the
 * reason rather than failing on a bare ENOTDIR.
 */
test("refuses to bury a legacy file-backed key under a new one", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "vrdex-secrets-"));
  const guildId = "100000000000000001";

  mkdirSync(path.join(root, "vrdex", "vrclinking"), { recursive: true });
  writeFileSync(path.join(root, "vrdex", "vrclinking", guildId), "legacy-key");

  await withEnv({ VRDEX_VRCLINKING_SECRET_DIR: root }, async () => {
    await assert.rejects(
      () => putVrclinkingDelegationKey(`vrdex/vrclinking/${guildId}/abc123`, "new-key"),
      /guild-scoped key already occupies/,
    );
  });
});

/**
 * The cleanup that follows that refusal.
 *
 * Every failed write is discarded by scheduling its key for deletion, and this
 * key's parent path is the legacy file — so POSIX answers `ENOTDIR` for a walk
 * through it, which `force` does not absorb the way it absorbs `ENOENT`. The
 * throw escaped into the route, and the row it could not confirm stayed
 * unretired: an obligation no sweep could settle, offered again every day for a
 * file that was never written.
 *
 * The key provably cannot exist, which is the same thing "already gone" means
 * everywhere else here.
 */
test("counts a key the legacy file blocks as already gone", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "vrdex-secrets-"));
  const guildId = "100000000000000002";

  mkdirSync(path.join(root, "vrdex", "vrclinking"), { recursive: true });
  writeFileSync(path.join(root, "vrdex", "vrclinking", guildId), "legacy-key");

  await withEnv({ VRDEX_VRCLINKING_SECRET_DIR: root }, async () => {
    await scheduleVrclinkingDelegationKeyDeletion(`vrdex/vrclinking/${guildId}/abc123`);
  });
});
