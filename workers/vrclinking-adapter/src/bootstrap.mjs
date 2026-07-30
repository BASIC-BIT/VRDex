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
export async function resolveAdapterDeps() {
  const secretDir = process.env.VRDEX_VRCLINKING_SECRET_DIR?.trim();
  let awsClient;

  if (process.env.VRDEX_VRCLINKING_ENABLE_AWS_SECRETS === "true") {
    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      "@aws-sdk/client-secrets-manager"
    );
    const client = new SecretsManagerClient({});
    awsClient = {
      getSecretValue: (secretId) => client.send(new GetSecretValueCommand({ SecretId: secretId })),
    };
  }

  /**
   * Prefer a Secrets Manager reference over a literal value.
   *
   * Lambda environment variables are readable by anyone holding
   * `lambda:GetFunctionConfiguration` — a wider audience than the execution
   * role — so the deployed function is given ARNs and resolves them here, at
   * cold start. The literal form stays for local runs and the container image,
   * where there is no Secrets Manager to read from.
   */
  async function sharedSecret(valueName, arnName) {
    const arn = process.env[arnName]?.trim();

    if (arn) {
      if (awsClient === undefined) {
        throw new Error(`${arnName} is set but AWS secret resolution is disabled.`);
      }

      const secret = await awsClient.getSecretValue(arn);
      const value = secret?.SecretString?.trim();

      if (!value) {
        throw new Error(`${arnName} resolved to an empty secret.`);
      }

      return value;
    }

    return requiredEnv(valueName);
  }

  const bearerToken = await sharedSecret(
    "VRCHAT_PROOF_ADAPTER_BEARER_TOKEN",
    "VRDEX_VRCLINKING_BEARER_SECRET_ARN",
  );
  // Read into the environment because `validateRequest` reaches for it directly
  // on every request, and required here rather than there: discovering it is
  // missing on first traffic is the failure this whole function exists to
  // avoid.
  const capabilityKey = await sharedSecret(
    "VRDEX_VRCLINKING_CAPABILITY_KEY",
    "VRDEX_VRCLINKING_CAPABILITY_SECRET_ARN",
  );

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
