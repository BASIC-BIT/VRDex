import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { deadline } from "./transport";
export async function readSecret(
  region: string,
  reference: string,
): Promise<string> {
  const client = new SecretsManagerClient({ region, maxAttempts: 1 });
  try {
    const reply = await client.send(
      new GetSecretValueCommand({ SecretId: reference }),
      { abortSignal: deadline(undefined, 4500) },
    );
    if (!reply.SecretString || reply.SecretString.length > 16384)
      throw Error("Invalid secret");
    return reply.SecretString;
  } catch {
    throw Error("Relay secret unavailable");
  } finally {
    client.destroy();
  }
}
