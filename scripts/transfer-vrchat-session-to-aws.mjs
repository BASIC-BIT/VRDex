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

// Pushing a dead cookie into Secrets Manager would leave the fleet failing
// authentication with no local signal, so confirm it still works first.
if (!skipValidation) {
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
    // Never on a dry run, though. A dry run skips the AWS write, so saving the
    // rotated cookies here would leave the vault ahead of Secrets Manager: the
    // deployed collector keeps presenting the superseded session and can fall
    // into `auth_required` purely because an operator rehearsed the transfer as
    // the runbook tells them to.
    if (
      !dryRun &&
      (refreshed.authCookie !== stored.authCookie ||
        refreshed.twoFactorAuthCookie !== stored.twoFactorAuthCookie)
    ) {
      await sessionStore.save(accountAlias, refreshed);
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
// CodeQL flags this as js/insufficient-password-hash. That alert is dismissed
// as a false positive in code scanning; inline suppression comments are not
// honoured by this repository's setup, so do not add one expecting it to work.
const workerKeyHash = createHash("sha256").update(workerApiKey).digest("hex").toLowerCase();

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

const next = buildSessionSecretPayload(existing, {
  workerApiKey,
  authCookie: stored.authCookie,
  twoFactorAuthCookie: stored.twoFactorAuthCookie,
});

if (!dryRun) {
  try {
    await client.send(
      secretMissing
        ? new CreateSecretCommand({
            Name: secretId,
            Description: "VRDex group telemetry collector session and worker key.",
            SecretString: JSON.stringify(next),
          })
        : new PutSecretValueCommand({ SecretId: secretId, SecretString: JSON.stringify(next) }),
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
      : `${secretMissing ? "Created" : "Updated"} secret ${secretId} in ${region}.`,
    `Service account:      ${stored.userId}`,
    `Session validated:    ${skipValidation ? "skipped" : "yes"}`,
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
