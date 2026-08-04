import {
  CreateSecretCommand,
  DeleteSecretCommand,
  PutSecretValueCommand,
  InvalidRequestException,
  ResourceExistsException,
  ResourceNotFoundException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Writes a community's delegated VRCLinking API key into the operator secret
 * store, so the community owner never has to.
 *
 * The delegation used to ask the owner for a `secret://vrdex/vrclinking/<guild>`
 * reference, which was a value they could not act on: only an operator can
 * write to Secrets Manager, so the form asked for a pointer to something the
 * person filling it in had no way to create. Every delegation registered that
 * way resolved to nothing.
 *
 * The key still never reaches Convex. It transits this process to Secrets
 * Manager, and Convex records only the derived reference — which is what the
 * adapter resolves through its own role.
 */

// Two segments after the prefix — guild, then credential row — because a
// per-credential name is what makes replacing a key non-destructive, and what
// keeps `vrdex/vrclinking/shared` (the adapter's own bearer token) outside the
// shape this role is granted. Convex derives the same name in
// `convex/_vrclinkingSecretRef.ts`; this only validates what it was handed.
const SECRET_NAME_PATTERN = /^vrdex\/vrclinking\/\d{17,20}\/[A-Za-z0-9]{1,64}$/;
// Deletion only. A delegation created before per-credential naming keeps its key
// under the guild-only name, so retiring it has to accept that shape — but
// nothing may ever *write* there: `vrdex/vrclinking/shared` is one segment deep
// too, and the guild segment is the only thing separating them. Writes stay on
// the two-segment pattern above; this admits a numeric guild and nothing else.
const LEGACY_SECRET_NAME_PATTERN = /^vrdex\/vrclinking\/\d{17,20}$/;

let cachedClient: { key: string; client: SecretsManagerClient } | null = null;

/**
 * Explicit, with no fall back to the ambient `AWS_REGION`.
 *
 * Vercel's runtime sets `AWS_REGION` to wherever the function happens to run,
 * which has nothing to do with where the delegated secrets live. Reading it
 * would make the store look configured on every deployment and then write each
 * community's key into whichever region served the request — a different store
 * from the one the adapter reads, so the delegation would register, report
 * success, and resolve to nothing.
 */
function storeRegion(): string | undefined {
  return process.env.VRDEX_VRCLINKING_SECRET_REGION?.trim() || undefined;
}

function roleArn(): string | undefined {
  return process.env.VRDEX_VRCLINKING_DELEGATION_ROLE_ARN?.trim() || undefined;
}

/**
 * The file backend the adapter already documents for self-hosting.
 *
 * `VRDEX_VRCLINKING_SECRET_DIR` is the adapter's supported alternative to
 * Secrets Manager, and writing was the half that did not exist — so a
 * file-backed deployment could resolve delegated keys but had no way to create
 * one once the reference-registration form was removed. Same directory, same
 * layout the resolver reads.
 */
/**
 * The customer-managed key delegated credentials must be created under.
 *
 * `CreateSecret` without it silently uses the AWS-managed Secrets Manager key,
 * and because every reservation creates a *new* name there is no later
 * `PutSecretValue` to correct it — so an installation that requires a CMK would
 * have had every delegated credential created outside it while the stack
 * advertised support. Unset means the AWS-managed key, which is the default this
 * stack has always assumed.
 */
function secretKmsKeyId(): string | undefined {
  return process.env.VRDEX_VRCLINKING_SECRET_KMS_KEY_ID?.trim() || undefined;
}

function secretDir(): string | undefined {
  return process.env.VRDEX_VRCLINKING_SECRET_DIR?.trim() || undefined;
}

function secretFilePath(directory: string, secretName: string): string {
  const resolved = path.resolve(directory, secretName);

  // The name is already validated against `SECRET_NAME_PATTERN`, which admits no
  // traversal — this refuses anything that escapes anyway, because a path join
  // is the wrong place to rely on a caller's validation holding forever.
  if (!resolved.startsWith(path.resolve(directory) + path.sep)) {
    throw new Error("Refusing to store a delegated key outside the secret directory.");
  }

  return resolved;
}

/**
 * Whether this deployment can accept a pasted key at all.
 *
 * Checked before the form offers the field rather than after a submit: an
 * environment without the grant can still register a delegation, and an owner
 * who pasted a key into one would be told it was saved while nothing had it.
 *
 * Both halves, because either alone is a deployment that fails at the write: a
 * region with no role cannot assume anything, and a role with no region has
 * nowhere to put the key.
 */
export function isVrclinkingSecretStoreConfigured(): boolean {
  return secretDir() !== undefined || (storeRegion() !== undefined && roleArn() !== undefined);
}

function secretsClient(): SecretsManagerClient {
  const region = storeRegion();

  if (region === undefined) {
    throw new Error("VRCLinking delegation storage is not configured.");
  }

  const arn = roleArn();
  const cacheKey = `${region}:${arn ?? "default"}`;

  if (cachedClient?.key === cacheKey) {
    return cachedClient.client;
  }

  const client = new SecretsManagerClient({
    region,
    ...(arn !== undefined ? { credentials: awsCredentialsProvider({ roleArn: arn }) } : {}),
  });

  cachedClient = { key: cacheKey, client };

  return client;
}

/**
 * Create-or-replace, because a community replacing its key is the common case
 * and the two AWS calls are different operations. `CreateSecret` on an existing
 * name throws rather than overwriting, so the exception is the signal to put a
 * new version rather than an error worth surfacing.
 */
export async function putVrclinkingDelegationKey(
  secretName: string,
  apiKey: string,
): Promise<void> {
  // Checked here rather than trusted, because this is the last place before an
  // AWS write that a name decides which object is replaced. The reservation is
  // authorized and server-derived, so a mismatch means a bug rather than an
  // attack — but a bug that writes to the wrong secret name is exactly the one
  // worth refusing.
  if (!SECRET_NAME_PATTERN.test(secretName)) {
    throw new Error("Refusing to store a delegated key under an unexpected secret name.");
  }

  const directory = secretDir();

  if (directory !== undefined) {
    const file = secretFilePath(directory, secretName);

    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, apiKey, { encoding: "utf8", mode: 0o600 });

    return;
  }

  const client = secretsClient();
  const kmsKeyId = secretKmsKeyId();
  const name = secretName;

  try {
    await client.send(
      new CreateSecretCommand({
        Name: name,
        SecretString: apiKey,
        Description: "VRCLinking API key delegated to VRDex by a community owner.",
        ...(kmsKeyId === undefined ? {} : { KmsKeyId: kmsKeyId }),
      }),
    );
  } catch (error) {
    if (!(error instanceof ResourceExistsException)) {
      throw error;
    }

    await client.send(new PutSecretValueCommand({ SecretId: name, SecretString: apiKey }));
  }
}

/**
 * Retire a key whose delegation was never activated.
 *
 * Names are per credential and never reused, so a key left behind by a failed
 * activation is unreachable forever: no row points at it and no later
 * reservation can land on the same name. Without this it would sit in Secrets
 * Manager indefinitely — a community's live VRCLinking credential, retained by
 * VRDex for nothing.
 *
 * Scheduled rather than forced. The seven-day recovery window is what makes
 * this safe to call from an error path: if the activation actually succeeded
 * and only its response was lost, the secret can be restored rather than being
 * gone the moment a retry misreads the situation.
 */
export async function scheduleVrclinkingDelegationKeyDeletion(secretName: string): Promise<void> {
  if (!SECRET_NAME_PATTERN.test(secretName) && !LEGACY_SECRET_NAME_PATTERN.test(secretName)) {
    throw new Error("Refusing to delete a secret outside the delegated-credential shape.");
  }

  const directory = secretDir();

  if (directory !== undefined) {
    // No recovery window to schedule against a file, so this is immediate. The
    // caller only reaches here once the key is provably unreachable.
    await rm(secretFilePath(directory, secretName), { force: true });

    return;
  }

  try {
    await secretsClient().send(
      new DeleteSecretCommand({ SecretId: secretName, RecoveryWindowInDays: 7 }),
    );
  } catch (error) {
    // Already gone, or already on its way. Both are the outcome this asks for.
    //
    // `ResourceNotFound` covers a key whose *creation* failed — treating that as
    // an error meant its reservation could never be confirmed, so every later
    // reservation retried deleting an object that was never there.
    // `InvalidRequest` is what AWS answers for a secret already scheduled for
    // deletion, which is exactly the retry after a confirmation that failed: the
    // delete had worked, and refusing it here left the row unconfirmed until the
    // seven-day recovery window closed.
    // `InvalidRequest` covers more than the idempotent case — Secrets Manager
    // also refuses to delete a primary secret while replicas exist, and the
    // secret survives. Treating the class as success would confirm the row
    // retired and suppress every future retry for a key that is still there, so
    // only the scheduled-for-deletion reason counts.
    const alreadyScheduled =
      error instanceof InvalidRequestException &&
      /scheduled for deletion/i.test(error.message ?? "");

    if (!(error instanceof ResourceNotFoundException) && !alreadyScheduled) {
      throw error;
    }
  }
}
