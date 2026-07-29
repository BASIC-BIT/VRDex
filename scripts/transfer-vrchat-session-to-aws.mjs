// Move a validated, alias-scoped VRChat service-account session from the local
// operating-system credential vault into that collector account's AWS Secrets
// Manager secret, and mint the worker API key at the same time.
//
// This is the gate step described in docs/deployment/group-telemetry-collector.md.
// It exists so operators never hand-extract cookies: no secret value is ever
// printed, passed as a process argument, or written to disk. The only thing this
// command emits is the SHA-256 digest of the generated worker key, which is what
// `communityTelemetry.registerCollectorAccount` needs.
//
// Passwords and TOTP seeds are never read, stored, or transmitted.

import { createHash, randomBytes } from "node:crypto";

import {
  VrchatKeychainSessionStore,
  VrchatSessionStoreError,
} from "../workers/group-telemetry/vrchat-session-store.mjs";
import { VrchatOperatorLogin } from "../workers/group-telemetry/vrchat-login.mjs";
import {
  buildSessionSecretPayload,
  preservedSecretKeys,
} from "../workers/group-telemetry/session-secret-payload.mjs";

const USAGE = `Usage:
  pnpm ops:vrchat-session:transfer -- --secret-id <arn-or-name> [options]

Moves the validated saved session for VRDEX_VRCHAT_PROOF_ACCOUNT_ALIAS into the
named AWS Secrets Manager secret and generates a new workerApiKey.

Required environment:
  VRDEX_VRCHAT_PROOF_ACCOUNT_ALIAS   Stable local alias, such as VRDex_Oak
  VRDEX_GROUP_TELEMETRY_USER_AGENT   Application/version/contact string
  AWS credentials in the ambient environment, with secretsmanager:GetSecretValue
  and secretsmanager:PutSecretValue on the target secret. A first run against a
  bare secret name that does not exist yet also needs secretsmanager:CreateSecret;
  pass an existing ARN instead if you would rather provision it separately.

Options:
  --secret-id <id>       Target secret ARN or name (required)
  --region <region>      AWS region; defaults to AWS_REGION, then us-east-1
  --skip-validation      Do not re-check the session against VRChat first
  --dry-run              Do everything except write the secret
  --help                 Show this message
`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function argValue(name) {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 1);

  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;

  const value = process.argv[index + 1];

  // `--secret-id --dry-run` must report a missing value rather than silently
  // treating the next flag as the secret name, which would target the wrong
  // Secrets Manager entry.
  if (value === undefined || value.startsWith("--")) {
    fail(`${name} requires a value.`);
  }

  return value;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} must be set.`);
  return value;
}

if (process.argv.includes("--help")) {
  process.stdout.write(USAGE);
  process.exit(0);
}

// A mistyped safety flag is the dangerous kind of typo here: `--dryrun` or
// `--dry-run=true` both left `dryRun` false, so a command meant as a rehearsal
// rotated the live VRChat session and wrote a production secret. Reject unknown
// options before anything is read or written.
const BOOLEAN_FLAGS = new Set(["--skip-validation", "--dry-run", "--help"]);
const VALUE_FLAGS = new Set(["--secret-id", "--region"]);

for (const arg of process.argv.slice(2)) {
  // Not an option: the value belonging to the flag before it. `argValue`
  // already refuses to read a flag as a value.
  if (!arg.startsWith("--")) continue;

  const name = arg.split("=")[0];

  if (BOOLEAN_FLAGS.has(name)) {
    if (arg !== name) fail(`${name} does not take a value.`);
    continue;
  }

  if (!VALUE_FLAGS.has(name)) {
    fail(`Unknown option ${name}.\n\n${USAGE}`);
  }
}

const secretId = argValue("--secret-id")?.trim();
const dryRun = process.argv.includes("--dry-run");
const skipValidation = process.argv.includes("--skip-validation");

if (!secretId) fail("--secret-id is required.\n\n" + USAGE);

// Accept a full ARN or a bare secret name, and reject anything that looks like a
// pasted credential so a mistyped invocation cannot exfiltrate one into a log.
if (!/^(arn:aws:secretsmanager:[^\s]+|[A-Za-z0-9/_+=.@-]{1,512})$/.test(secretId)) {
  fail("--secret-id must be a Secrets Manager ARN or secret name.");
}

const accountAlias = requiredEnv("VRDEX_VRCHAT_PROOF_ACCOUNT_ALIAS");
const userAgent = requiredEnv("VRDEX_GROUP_TELEMETRY_USER_AGENT");

const sessionStore = new VrchatKeychainSessionStore();
let stored;

try {
  stored = await sessionStore.load(accountAlias);
} catch (error) {
  if (error instanceof VrchatSessionStoreError && error.code === "invalid_session_removed") {
    fail(`The saved session for ${accountAlias} was invalid and has been removed. Re-run the login bootstrap.`);
  }
  throw error;
}

if (stored === undefined) {
  fail(`No saved VRChat session exists for ${accountAlias}. Run the login bootstrap first.`);
}

// AWS first, deliberately. Validating the session below applies whatever
// `Set-Cookie` VRChat returns, which supersedes the cookies the running
// collector holds — so it must not happen until the target secret has been
// read and its shape checked. Rotating and then failing on a wrong secret id,
// region, or missing permission would leave production authenticating with a
// cookie this command already invalidated.

const {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  CreateSecretCommand,
} = await import("@aws-sdk/client-secrets-manager").catch(() => {
  fail("@aws-sdk/client-secrets-manager is not installed. Run pnpm install first.");
});

// The ambient environment does not always carry a default region, and the SDK
// reports that as a bare `Error`, so resolve it explicitly.
const explicitRegion =
  argValue("--region")?.trim() ||
  process.env.AWS_REGION?.trim() ||
  process.env.AWS_DEFAULT_REGION?.trim();
const region = explicitRegion || "us-east-1";
const client = new SecretsManagerClient({ region });
let existing = {};
let secretMissing = false;

// Surfaces the SDK's own message: these are configuration and permission
// errors, never secret material, and hiding them makes a first run
// undiagnosable.
function describeAwsError(error) {
  const name = error?.name && error.name !== "Error" ? error.name : undefined;
  const message = typeof error?.message === "string" ? error.message : undefined;

  return name ?? message ?? "unknown error";
}

try {
  const current = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

  // Anything already here that is not a JSON object would be replaced wholesale
  // by the write below. A mistyped secret id or a legacy format should stop the
  // command, not silently destroy unrelated values.
  if (current.SecretBinary !== undefined) {
    fail(`${secretId} holds binary data. Refusing to overwrite it; check the secret id.`);
  }

  if (typeof current.SecretString === "string" && current.SecretString.trim().length > 0) {
    let parsed;

    try {
      parsed = JSON.parse(current.SecretString);
    } catch {
      fail(`${secretId} does not hold JSON. Refusing to overwrite it; check the secret id.`);
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail(`${secretId} does not hold a JSON object. Refusing to overwrite it; check the secret id.`);
    }

    existing = parsed;
  }
} catch (error) {
  if (error?.name === "ResourceNotFoundException") {
    secretMissing = true;
  } else {
    fail(`Could not read the target secret (region ${region}): ${describeAwsError(error)}`);
  }
}

// CreateSecret takes a name, not an ARN. An ARN naming a secret that does not
// exist is a typo rather than a first run, so say so instead of creating a
// second secret under a mangled name.
if (secretMissing && secretId.startsWith("arn:")) {
  fail(`No secret exists at ${secretId}. Check the ARN, or pass a name to create it.`);
}

// "Not found" in the wrong region looks exactly like "not created yet", and the
// create path would then write a second copy of the live session cookies into
// an unintended region while reporting success. Creating is only safe when the
// operator said which region they meant.
if (secretMissing && !explicitRegion) {
  fail(
    `No secret named ${secretId} exists in ${region}, which is only a default guess. ` +
      "Pass --region (or set AWS_REGION) to confirm where it should be created.",
  );
}

// Which collector account this secret belongs to. Validation below proves the
// session is live, but it takes `expectedUserId` from the session itself, so it
// cannot notice that alias A has been paired with account B's secret id. Left
// unchecked, that pairing deploys A's cookies under an identity Convex and the
// ECS task still resolve as B.
if (typeof existing.vrchatUserId === "string" && existing.vrchatUserId !== stored.userId) {
  fail(
    `${secretId} holds the session for ${existing.vrchatUserId}, but ` +
      `${accountAlias} is ${stored.userId}. Check the alias and the secret id; ` +
      "refusing to transfer one account's session into another's secret.",
  );
}

// Reading the secret proves nothing about writing it. A role with
// GetSecretValue and no PutSecretValue got all the way past validation — which
// rotates the live session — before failing, leaving the deployed collector
// authenticating with cookies this command had already superseded. Prove the
// write path first: an unchanged Put for a secret that exists, and the creation
// itself for one that does not.
//
// A dry run writes nothing at all, so it cannot prove this and does not try.
const secretCreated = secretMissing && !dryRun;

if (!dryRun) {
  try {
    await client.send(
      secretMissing
        ? new CreateSecretCommand({
            Name: secretId,
            Description: "VRDex group telemetry collector session and worker key.",
            SecretString: JSON.stringify({}),
          })
        : new PutSecretValueCommand({
            SecretId: secretId,
            SecretString: JSON.stringify(existing),
          }),
    );
  } catch (error) {
    fail(`Cannot write the target secret (region ${region}): ${describeAwsError(error)}`);
  }

  // It exists now either way, so the real write below is always a Put.
  secretMissing = false;
}

// Pushing a dead cookie into Secrets Manager would leave the fleet failing
// authentication with no local signal, so confirm it still works first.
//
// Not on a dry run, though, and not because validation is slow: VRChat applies
// `Set-Cookie` during validation, so validating *rotates the live session*. A
// rehearsal that rotates and then writes the result nowhere leaves both the
// vault and Secrets Manager holding a superseded cookie, and the running
// collector can reach `auth_required` purely because an operator did the
// rehearsal the runbook asks for. A dry run must not touch provider state.
if (dryRun && !skipValidation) {
  process.stdout.write(
    "Dry run: skipping session validation, because validating applies any cookie " +
      "rotation VRChat returns and a dry run has nowhere to persist it. " +
      "Re-run without --dry-run to validate and transfer in one step.\n\n",
  );
}

let localSaveFailure;

if (!skipValidation && !dryRun) {
  const login = new VrchatOperatorLogin({
    userAgent,
    accountAlias,
    expectedUserId: stored.userId,
  });

  try {
    // Validation applies any `Set-Cookie` the provider returns and hands back
    // the refreshed session. Discarding it would write the pre-rotation cookies
    // and deploy a credential that is already stale.
    const refreshed = (await login.validateSession(stored)) ?? stored;

    // Persist rotation locally too. Writing only to AWS would leave the vault
    // holding pre-rotation cookies, so the next local run would validate an
    // already-superseded session.
    //
    // Not fatal, though. VRChat has already rotated the live session by this
    // point, so aborting on a locked keychain would leave the rotated cookies
    // in neither destination and walk the running collector into
    // `auth_required`. Getting them into Secrets Manager is what keeps the
    // fleet alive; the vault copy is a convenience for the next local run.
    if (
      refreshed.authCookie !== stored.authCookie ||
      refreshed.twoFactorAuthCookie !== stored.twoFactorAuthCookie
    ) {
      try {
        await sessionStore.save(accountAlias, refreshed);
      } catch (error) {
        localSaveFailure = error?.message ?? "unknown error";
      }
    }

    stored = refreshed;
  } catch (error) {
    fail(
      `The saved session for ${accountAlias} did not validate against VRChat (${error?.message ?? "unknown error"}). ` +
        "Refresh it with the login bootstrap before transferring.",
    );
  }
}

// At least 32 bytes, per the runbook. base64url keeps it shell-safe if an
// operator ever has to move it by hand, though nothing here prints it.
const workerApiKey = randomBytes(48).toString("base64url");
// SHA-256 is correct here and a slow KDF would not be. This is a bearer-token
// digest, not a password hash: the input is 48 cryptographically random bytes
// (384 bits), so there is no guessable keyspace for a work factor to defend.
// Argon2/bcrypt exist to slow brute force against low-entropy human-chosen
// secrets; applying one to a random token buys nothing and costs the control
// plane a verification round-trip on every worker request. The registration
// contract also pins this: `registerCollectorAccount` validates the digest
// against /^[a-f0-9]{64}$/.
//
// CodeQL flags this as js/insufficient-password-hash, and will keep doing so:
// inline suppression comments are not honoured by this repository's setup, and
// the alert re-appears as "new" on any commit that touches this file, failing
// the PR check until an operator dismisses it as a false positive in code
// scanning. Do not swap in a KDF to silence it. `convex/http.ts` verifies a
// presented worker key by hashing it on every request in the Convex runtime,
// which has Web Crypto and no scrypt; the only KDF available there is PBKDF2,
// which would add a derivation per request to defend a keyspace that does not
// exist.
const workerKeyHash = createHash("sha256").update(workerApiKey).digest("hex").toLowerCase();

const next = buildSessionSecretPayload(existing, {
  workerApiKey,
  authCookie: stored.authCookie,
  twoFactorAuthCookie: stored.twoFactorAuthCookie,
  vrchatUserId: stored.userId,
});

if (!dryRun) {
  // Always a Put: the preflight above created the secret if it did not exist.
  try {
    await client.send(
      new PutSecretValueCommand({ SecretId: secretId, SecretString: JSON.stringify(next) }),
    );
  } catch (error) {
    fail(`Could not write the target secret (region ${region}): ${describeAwsError(error)}`);
  }
}

const preservedKeys = preservedSecretKeys(existing);

process.stdout.write(
  [
    dryRun
      ? "Dry run: no secret was written."
      : `${secretCreated ? "Created" : "Updated"} secret ${secretId} in ${region}.`,
    `Service account:      ${stored.userId}`,
    `Session validated:    ${skipValidation || dryRun ? "skipped" : "yes"}`,
    ...(localSaveFailure === undefined
      ? []
      : [
          `Local vault:          NOT updated (${localSaveFailure}). ` +
            "The cookies above are deployed but the vault still holds the pre-rotation " +
            "pair; re-run the login bootstrap before the next local transfer.",
        ]),
    `Two-factor cookie:    ${stored.twoFactorAuthCookie === undefined ? "absent" : "included"}`,
    `Preserved keys:       ${preservedKeys.length === 0 ? "(none)" : preservedKeys.join(", ")}`,
    "",
    dryRun
      // The key this hash covers was never written, so registering it would
      // make every worker credential check fail.
      ? "Dry run: no key was stored, so there is nothing to register. Re-run without --dry-run."
      : "Register the collector with this hash (safe to copy; it is not a secret):",
    ...(dryRun ? [] : [`  workerKeyHash: ${workerKeyHash}`]),
    ...(dryRun
      ? []
      : [`  secretRef:     ${secretId.startsWith("arn:") ? secretId : `secret://${secretId}`}`]),
    "",
    "The worker API key and session cookies were never printed." +
      (dryRun ? "" : " Restart the ECS task after registering so it picks up the new credential generation."),
    "",
  ].join("\n"),
);
