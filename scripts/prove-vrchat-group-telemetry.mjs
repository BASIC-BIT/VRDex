import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { VrchatClient, VrchatProviderError } from "../workers/group-telemetry/vrchat-client.mjs";
import { VrchatOperatorLogin, VrchatSessionValidationError } from "../workers/group-telemetry/vrchat-login.mjs";
import { VrchatKeychainSessionStore, VrchatSessionStoreError } from "../workers/group-telemetry/vrchat-session-store.mjs";
import { failureDisposition, randomPollDelayMs } from "../workers/group-telemetry/runtime.mjs";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: pnpm proof:group-telemetry -- [--allow-join] [--duration-minutes=240] [--fresh-login]
       pnpm proof:group-telemetry -- --clear-session

Authentication defaults to the account-scoped operating-system credential vault. A missing,
expired, or deliberately bypassed session starts a local browser login. No plaintext fallback
is used. --auth-from-env remains an explicit development fallback and bypasses the vault.

Required environment:
  VRDEX_VRCHAT_PROOF_ACCOUNT_ALIAS  Stable local alias, such as VRDex_Oak
  VRDEX_VRCHAT_PROOF_GROUP_ID       Approved consenting VRChat group ID
  VRDEX_GROUP_TELEMETRY_USER_AGENT  Identifying contact user agent
  VRDEX_GROUP_TELEMETRY_PROOF_ENABLED  Must be true for provider requests

Optional identity guard:
  VRDEX_VRCHAT_PROOF_USER_ID        Expected VRDex service-account usr_ ID

Session controls:
  --fresh-login                     Skip the saved session and replace it after login
  --clear-session                   Remove the alias-scoped session and exit

Explicit --auth-from-env fallback:
  VRDEX_VRCHAT_PROOF_AUTH_COOKIE    Pre-provisioned service-account auth cookie
  VRDEX_VRCHAT_PROOF_2FA_COOKIE     Optional service-account two-factor cookie

Create artifacts/group-telemetry-proof/STOP to stop a running proof safely.
The proof writes only sanitized aggregate evidence under artifacts/group-telemetry-proof/.`);
  process.exit(0);
}

const authFromEnv = process.argv.includes("--auth-from-env");
const freshLogin = process.argv.includes("--fresh-login");
const clearSession = process.argv.includes("--clear-session");
const allowJoin = process.argv.includes("--allow-join");
if (authFromEnv && (freshLogin || clearSession)) {
  throw new Error("--auth-from-env cannot be combined with --fresh-login or --clear-session.");
}

const accountAlias = authFromEnv ? undefined : requiredEnv("VRDEX_VRCHAT_PROOF_ACCOUNT_ALIAS");
const sessionStore = authFromEnv ? undefined : new VrchatKeychainSessionStore();
if (clearSession) {
  const removed = await sessionStore.clear(accountAlias);
  console.log(removed
    ? `Removed the saved VRChat session for ${accountAlias}.`
    : `No saved VRChat session exists for ${accountAlias}.`);
  process.exit(0);
}

if (process.env.VRDEX_GROUP_TELEMETRY_PROOF_ENABLED !== "true") {
  throw new Error("VRDEX_GROUP_TELEMETRY_PROOF_ENABLED must be true before provider requests are allowed.");
}

const groupId = requiredEnv("VRDEX_VRCHAT_PROOF_GROUP_ID");
const userAgent = requiredEnv("VRDEX_GROUP_TELEMETRY_USER_AGENT");
const expectedUserId = process.env.VRDEX_VRCHAT_PROOF_USER_ID?.trim() || undefined;
const durationArg = process.argv.find((value) => value.startsWith("--duration-minutes="));
const loginTimeoutArg = process.argv.find((value) => value.startsWith("--login-timeout-minutes="));
const stopFileArg = process.argv.find((value) => value.startsWith("--stop-file="));
const durationMinutes = Number(durationArg?.split("=")[1] ?? 0);
if (!Number.isInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > 1_440) {
  throw new Error("--duration-minutes must be a whole number from 0 through 1440.");
}
const loginTimeoutMinutes = Number(loginTimeoutArg?.split("=")[1] ?? 10);
if (!Number.isInteger(loginTimeoutMinutes) || loginTimeoutMinutes < 1 || loginTimeoutMinutes > 30) {
  throw new Error("--login-timeout-minutes must be a whole number from 1 through 30.");
}
const stopFile = stopFileArg?.slice("--stop-file=".length) || join("artifacts", "group-telemetry-proof", "STOP");
const login = new VrchatOperatorLogin({
  userAgent,
  expectedUserId,
  accountAlias,
  timeoutMs: loginTimeoutMinutes * 60_000,
});
let session;
let authenticationMode;
if (authFromEnv) {
  session = await login.validateSession({
    authCookie: requiredEnv("VRDEX_VRCHAT_PROOF_AUTH_COOKIE"),
    twoFactorAuthCookie: process.env.VRDEX_VRCHAT_PROOF_2FA_COOKIE?.trim() || undefined,
  });
  authenticationMode = "cookie_environment_fallback";
} else if (!freshLogin) {
  let storedSession;
  try {
    storedSession = await sessionStore.load(accountAlias);
  } catch (error) {
    if (!(error instanceof VrchatSessionStoreError) || error.code !== "invalid_session_removed") throw error;
    process.stderr.write(`${error.message}\n`);
  }
  if (storedSession) {
    try {
      session = await login.validateSession(storedSession);
      await sessionStore.save(accountAlias, session);
      authenticationMode = "local_keychain_reuse";
    } catch (error) {
      if (!(error instanceof VrchatSessionValidationError) || !error.clearable) throw error;
      await sessionStore.clear(accountAlias);
      process.stderr.write("The expired or mismatched saved VRChat session was removed; interactive login is required.\n");
    }
  }
}
if (!session) {
  const { url } = await login.start();
  process.stderr.write(`Open this local VRDex service-account login URL in your browser:\n${url}\n`);
  session = await login.waitForLogin();
  await sessionStore.save(accountAlias, session);
  process.stderr.write(`Saved the validated VRChat session for ${accountAlias} in the operating-system credential vault.\n`);
  authenticationMode = "local_loopback_keychain";
}
const client = new VrchatClient({
  authCookie: session.authCookie,
  twoFactorAuthCookie: session.twoFactorAuthCookie,
  userAgent,
});
const startedAt = Date.now();
const rateLimitPolicyNow = 1_700_000_000_000;
const rateLimitPolicyRetryAfterMs = 60_000;
const rateLimitPolicy = failureDisposition(
  new VrchatProviderError("Synthetic rate-limit policy check.", {
    status: 429,
    retryAfterMs: rateLimitPolicyRetryAfterMs,
    category: "rate_limit",
  }),
  1,
  rateLimitPolicyNow,
  () => 0.5,
);
const states = [];
const statusClasses = {};
let samples = 0;
let nonEmptySamples = 0;
let retries = 0;
let backoffMs = 0;
let consecutiveFailures = 0;
let stopping = false;
let stopReason = "duration_complete";

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopping = true;
    stopReason = signal.toLowerCase();
  });
}

async function stopRequested() {
  if (stopping) return true;
  try {
    await access(stopFile);
    stopping = true;
    stopReason = "stop_file";
    return true;
  } catch {
    return false;
  }
}

async function interruptibleSleep(delayMs) {
  const wakeAt = Date.now() + delayMs;
  while (Date.now() < wakeAt && !(await stopRequested())) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, wakeAt - Date.now())));
  }
}

if (await stopRequested()) throw new Error(`Proof stop file is present at ${stopFile}. Remove it before starting a run.`);

async function clearSessionAfterAuthenticationFailure(error) {
  if (sessionStore && error instanceof VrchatProviderError && error.status === 401) {
    await sessionStore.clear(accountAlias);
    process.stderr.write("The rejected VRChat session was removed from the operating-system credential vault.\n");
  }
}

let initial;
try {
  initial = await client.getGroup(groupId);
} catch (error) {
  await clearSessionAfterAuthenticationFailure(error);
  throw error;
}
states.push({ state: initial.membershipStatus, joinPolicy: initial.joinPolicy, groupVisibility: initial.groupVisibility });
let readyForCollection = initial.membershipStatus === "member";
if (initial.membershipStatus !== "member") {
  if (!allowJoin) {
    stopReason = "read_only_membership_check";
  } else {
    const connected = await client.connectGroup(groupId);
    states.push({ state: connected.state, transition: connected.transition, joinPolicy: connected.joinPolicy, groupVisibility: connected.groupVisibility });
    readyForCollection = connected.state === "active";
    if (!readyForCollection) stopReason = `membership_${connected.state}`;
  }
}

const deadline = startedAt + durationMinutes * 60_000;
while (readyForCollection && Date.now() <= deadline && !stopping) {
  if (await stopRequested()) break;
  let delayMs = 0;
  try {
    const current = await client.getGroup(groupId);
    if (current.membershipStatus !== "member") {
      stopReason = `membership_${current.membershipStatus}`;
      break;
    }
    const snapshot = await client.readAggregateSnapshot(groupId);
    samples += 1;
    if (snapshot.instances.length > 0) nonEmptySamples += 1;
    consecutiveFailures = 0;
    delayMs = randomPollDelayMs(snapshot.instances.length > 0);
  } catch (error) {
    await clearSessionAfterAuthenticationFailure(error);
    consecutiveFailures += 1;
    retries += 1;
    const failure = failureDisposition(error, consecutiveFailures);
    statusClasses[failure.statusClass] = (statusClasses[failure.statusClass] ?? 0) + 1;
    delayMs = Math.max(0, failure.backoffUntil - Date.now());
    backoffMs += delayMs;
    if (failure.stopAccount || (error instanceof VrchatProviderError && error.status === 403)) {
      stopReason = failure.stopAccount ? "authentication_failure" : "provider_moderation_or_membership_failure";
      break;
    }
  }
  if (Date.now() >= deadline) break;
  await interruptibleSleep(Math.min(delayMs, Math.max(0, deadline - Date.now())));
}

const endedAt = Date.now();
const evidence = {
  schemaVersion: 2,
  targetHash: createHash("sha256").update(groupId).digest("hex").slice(0, 16),
  serviceAccountHash: session.userId
    ? createHash("sha256").update(session.userId).digest("hex").slice(0, 16)
    : undefined,
  authenticationMode,
  startedAt: new Date(startedAt).toISOString(),
  endedAt: new Date(endedAt).toISOString(),
  durationMinutes: (endedAt - startedAt) / 60_000,
  requestedDurationMinutes: durationMinutes,
  stopReason,
  states,
  aggregateSamples: samples,
  samplesWithVisibleInstances: nonEmptySamples,
  requestCounts: client.requestCounts,
  statusClasses,
  retries,
  backoffMs,
  policyChecks: {
    rateLimitBackoff: {
      kind: "synthetic_no_provider_request",
      statusClass: rateLimitPolicy.statusClass,
      retryAfterMs: rateLimitPolicyRetryAfterMs,
      computedBackoffMs: rateLimitPolicy.backoffUntil - rateLimitPolicyNow,
      honorsRetryAfter: rateLimitPolicy.backoffUntil - rateLimitPolicyNow >= rateLimitPolicyRetryAfterMs,
      stopsAccount: rateLimitPolicy.stopAccount,
    },
  },
  credentialsIncluded: false,
};
// The reads above may have rotated the session. The client followed it in
// memory only; the next command, the transfer, loads the vault, so a stale
// vault copy would validate a retired cookie and fail.
if (authenticationMode !== "cookie_environment_fallback" && (client.authCookie !== session.authCookie || client.twoFactorAuthCookie !== session.twoFactorAuthCookie)) {
  session = { ...session, authCookie: client.authCookie, twoFactorAuthCookie: client.twoFactorAuthCookie };
  await sessionStore.save(accountAlias, session);
  process.stderr.write(`VRChat rotated the session during the run; the vault copy for ${accountAlias} was updated.\n`);
}
await mkdir("artifacts/group-telemetry-proof", { recursive: true });
const path = join("artifacts/group-telemetry-proof", `proof-${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}.json`);
await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ evidencePath: path, ...evidence }, null, 2));
