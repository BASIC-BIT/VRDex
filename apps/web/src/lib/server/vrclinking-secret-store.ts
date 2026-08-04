import {
  CreateSecretCommand,
  PutSecretValueCommand,
  ResourceExistsException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

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

const SECRET_NAME_PREFIX = "vrdex/vrclinking/";

let cachedClient: { key: string; client: SecretsManagerClient } | null = null;

export function vrclinkingSecretName(guildId: string): string {
  return `${SECRET_NAME_PREFIX}${guildId}`;
}

function storeRegion(): string | undefined {
  const region =
    process.env.VRDEX_VRCLINKING_SECRET_REGION ??
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION;

  return region?.trim() || undefined;
}

function roleArn(): string | undefined {
  return process.env.VRDEX_VRCLINKING_DELEGATION_ROLE_ARN?.trim() || undefined;
}

/**
 * Whether this deployment can accept a pasted key at all.
 *
 * Checked before the form offers the field rather than after a submit: an
 * environment without the grant can still register a delegation, and an owner
 * who pasted a key into one would be told it was saved while nothing had it.
 */
export function isVrclinkingSecretStoreConfigured(): boolean {
  return storeRegion() !== undefined;
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
export async function putVrclinkingDelegationKey(guildId: string, apiKey: string): Promise<void> {
  const client = secretsClient();
  const name = vrclinkingSecretName(guildId);

  try {
    await client.send(
      new CreateSecretCommand({
        Name: name,
        SecretString: apiKey,
        Description: `VRCLinking API key delegated to VRDex for Discord guild ${guildId}.`,
      }),
    );
  } catch (error) {
    if (!(error instanceof ResourceExistsException)) {
      throw error;
    }

    await client.send(new PutSecretValueCommand({ SecretId: name, SecretString: apiKey }));
  }
}
