import { createSecretResolver } from "./secret-resolver.mjs";
import { createVrclinkingClient } from "./vrclinking-client.mjs";

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be configured.`);
  }

  return value;
}

/**
 * Read the environment once and build what the handler needs.
 *
 * Shared by both transports so a deployment cannot be healthy on one and broken
 * on the other. Every check here fails at construction rather than on the first
 * real request: a process that starts, answers `/healthz`, and then rejects
 * every delegation is the state this is written to avoid — orchestration calls
 * it healthy and the fault surfaces as a claimant's unexplained failure.
 */
export async function resolveAdapterDeps({ awsClient: injectedClient } = {}) {
  const secretDir = process.env.VRDEX_VRCLINKING_SECRET_DIR?.trim();
  let awsClient = injectedClient;

  if (awsClient === undefined && process.env.VRDEX_VRCLINKING_ENABLE_AWS_SECRETS === "true") {
    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      "@aws-sdk/client-secrets-manager"
    );
    const client = new SecretsManagerClient({});
    awsClient = {
      getSecretValue: (secretId) => client.send(new GetSecretValueCommand({ SecretId: secretId })),
    };
  }

  /**
   * Both shared secrets, from one Secrets Manager object.
   *
   * One object, not two, because two cannot be written atomically: a cold start
   * landing between the writes cached a new bearer against an old capability
   * key and held that pair for its container's life, and a failed second write
   * left that as the resting state. Every attempt to bound that window — recycle
   * on failure, roll forward, check health afterwards — was a workaround for a
   * mid-write state that a single `PutSecretValue` simply does not have.
   *
   * Resolved here rather than passed as Lambda environment variables, which are
   * readable by anyone holding `lambda:GetFunctionConfiguration` — a wider
   * audience than the execution role. The literal forms stay for local runs and
   * the container image, where there is no Secrets Manager to read from.
   */
  async function sharedSecrets() {
    const arn = process.env.VRDEX_VRCLINKING_SHARED_SECRET_ARN?.trim();

    if (!arn) {
      return {
        bearerToken: requiredEnv("VRCHAT_PROOF_ADAPTER_BEARER_TOKEN"),
        capabilityKey: requiredEnv("VRDEX_VRCLINKING_CAPABILITY_KEY"),
      };
    }

    if (awsClient === undefined) {
      throw new Error(
        "VRDEX_VRCLINKING_SHARED_SECRET_ARN is set but AWS secret resolution is disabled.",
      );
    }

    const secret = await awsClient.getSecretValue(arn);
    const raw = secret?.SecretString?.trim();

    if (!raw) {
      throw new Error("VRDEX_VRCLINKING_SHARED_SECRET_ARN resolved to an empty secret.");
    }

    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "The shared secret must be JSON with `bearerToken` and `capabilityKey` fields.",
      );
    }

    const bearerToken = typeof parsed?.bearerToken === "string" ? parsed.bearerToken.trim() : "";
    const capabilityKey =
      typeof parsed?.capabilityKey === "string" ? parsed.capabilityKey.trim() : "";

    if (!bearerToken || !capabilityKey) {
      throw new Error("The shared secret is missing `bearerToken` or `capabilityKey`.");
    }

    return { bearerToken, capabilityKey };
  }

  // Required here rather than at first use: discovering either is missing on
  // first traffic is the failure this whole function exists to avoid.
  const { bearerToken, capabilityKey } = await sharedSecrets();

  // The capability exists to be unknown to whoever holds the bearer token. Point
  // both at one value and that stops being true: a leaked token is then also the
  // HMAC key, so its holder can mint capabilities for guessed guild ids and
  // spend every delegated credential the execution role can reach. Refusing to
  // start is the only place this is catchable — the two are indistinguishable
  // once a request arrives.
  if (bearerToken === capabilityKey) {
    throw new Error(
      "The bearer token and capability key must be different values; the capability check is decorative otherwise.",
    );
  }

  process.env.VRDEX_VRCLINKING_CAPABILITY_KEY = capabilityKey;

  // `!secretDir`, not `=== undefined`: a templated-but-unset deployment
  // variable arrives as an empty string, which would leave the guard passing on
  // a process that can resolve nothing.
  if (!secretDir && awsClient === undefined) {
    throw new Error(
      "No secret backend configured. Set VRDEX_VRCLINKING_SECRET_DIR or VRDEX_VRCLINKING_ENABLE_AWS_SECRETS=true.",
    );
  }

  return {
    bearerToken,
    resolveSecret: createSecretResolver({ secretDir, awsClient }),
    getGuildMemberByDiscordId: createVrclinkingClient(),
  };
}
