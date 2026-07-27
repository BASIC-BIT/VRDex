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
  and secretsmanager:PutSecretValue on the target secret only.

Options:
  --secret-id <id>       Target secret ARN or name (required)
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
  return index >= 0 ? process.argv[index + 1] : undefined;
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
    await login.validateSession(stored);
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
const workerKeyHash = createHash("sha256").update(workerApiKey).digest("hex").toLowerCase();

const {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  CreateSecretCommand,
} = await import("@aws-sdk/client-secrets-manager").catch(() => {
  fail("@aws-sdk/client-secrets-manager is not installed. Run pnpm install first.");
});

const client = new SecretsManagerClient({});
let existing = {};
let secretMissing = false;

try {
  const current = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

  if (typeof current.SecretString === "string" && current.SecretString.trim().startsWith("{")) {
    existing = JSON.parse(current.SecretString);
  }
} catch (error) {
  if (error?.name === "ResourceNotFoundException") {
    secretMissing = true;
  } else {
    fail(`Could not read the target secret: ${error?.name ?? "unknown error"}.`);
  }
}

// CreateSecret takes a name, not an ARN. An ARN naming a secret that does not
// exist is a typo rather than a first run, so say so instead of creating a
// second secret under a mangled name.
if (secretMissing && secretId.startsWith("arn:")) {
  fail(`No secret exists at ${secretId}. Check the ARN, or pass a name to create it.`);
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
    fail(`Could not write the target secret: ${error?.name ?? "unknown error"}.`);
  }
}

const preservedKeys = preservedSecretKeys(existing);

process.stdout.write(
  [
    dryRun ? "Dry run: no secret was written." : `Updated secret ${secretId}.`,
    `Service account:      ${stored.userId}`,
    `Session validated:    ${skipValidation ? "skipped" : "yes"}`,
    `Two-factor cookie:    ${stored.twoFactorAuthCookie === undefined ? "absent" : "included"}`,
    `Preserved keys:       ${preservedKeys.length === 0 ? "(none)" : preservedKeys.join(", ")}`,
    "",
    "Register the collector with this hash (safe to copy; it is not a secret):",
    `  workerKeyHash: ${workerKeyHash}`,
    `  secretRef:     ${secretId.startsWith("arn:") ? secretId : `secret://${secretId}`}`,
    "",
    "The worker API key and session cookies were never printed. Restart the ECS",
    "task after registering so it picks up the new credential generation.",
    "",
  ].join("\n"),
);
