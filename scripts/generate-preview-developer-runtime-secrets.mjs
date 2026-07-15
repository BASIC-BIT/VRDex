import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const defaultOutputDirectory = ".tmp-gh-artifacts/preview-developer-runtime";

export const previewDeveloperRuntimeSecretFiles = Object.freeze({
  apiTokenPepper: "api-token-pepper",
  oauthAccessTokenSigningKey: "oauth-access-token-signing-key",
  oauthClientSecretPepper: "oauth-client-secret-pepper",
  oauthRefreshTokenPepper: "oauth-refresh-token-pepper",
});

export function createPreviewDeveloperRuntimeSecrets() {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const randomSecret = () => randomBytes(32).toString("hex");

  return {
    apiTokenPepper: randomSecret(),
    oauthAccessTokenSigningKey: privateKey.trimEnd().replaceAll("\n", "\\n"),
    oauthClientSecretPepper: randomSecret(),
    oauthRefreshTokenPepper: randomSecret(),
  };
}

export async function writePreviewDeveloperRuntimeSecrets(outputDirectory = defaultOutputDirectory) {
  const outputPath = path.resolve(outputDirectory);
  const values = createPreviewDeveloperRuntimeSecrets();

  await mkdir(outputPath, { recursive: true });
  await Promise.all(
    Object.entries(previewDeveloperRuntimeSecretFiles).map(([key, fileName]) =>
      writeFile(path.join(outputPath, fileName), values[key], { encoding: "utf8", mode: 0o600 }),
    ),
  );

  return { outputPath };
}

async function main() {
  if (process.argv.length > 3) {
    throw new Error("Usage: node scripts/generate-preview-developer-runtime-secrets.mjs [output-directory]");
  }

  const files = await writePreviewDeveloperRuntimeSecrets(process.argv[2]);
  console.log(`[preview-developer-runtime] Wrote ${Object.keys(previewDeveloperRuntimeSecretFiles).length} secret files under ${files.outputPath}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
