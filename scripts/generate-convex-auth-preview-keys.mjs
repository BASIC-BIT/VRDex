import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const defaultOutputDirectory = ".tmp-gh-artifacts/convex-auth-preview";

export function createConvexAuthKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" });
  const publicJwk = publicKey.export({ format: "jwk" });

  assert.equal(publicJwk.kty, "RSA", "Convex Auth public key must be RSA.");

  return {
    jwtPrivateKey: privateKeyPem.trimEnd().replaceAll("\n", " "),
    jwks: JSON.stringify({ keys: [{ use: "sig", ...publicJwk }] }),
  };
}

export async function writeConvexAuthKeyPair(outputDirectory = defaultOutputDirectory) {
  const outputPath = path.resolve(outputDirectory);
  const values = createConvexAuthKeyPair();
  const privateKeyPath = path.join(outputPath, "jwt-private-key");
  const jwksPath = path.join(outputPath, "jwks.json");

  await mkdir(outputPath, { recursive: true });
  await Promise.all([
    writeFile(privateKeyPath, values.jwtPrivateKey, { encoding: "utf8", mode: 0o600 }),
    writeFile(jwksPath, values.jwks, { encoding: "utf8", mode: 0o600 }),
  ]);

  return { jwksPath, outputPath, privateKeyPath };
}

async function main() {
  assert.ok(process.argv.length <= 3, "Usage: node scripts/generate-convex-auth-preview-keys.mjs [output-directory]");
  const files = await writeConvexAuthKeyPair(process.argv[2]);

  console.log(`[convex-auth-preview] Wrote private key to ${files.privateKeyPath}.`);
  console.log(`[convex-auth-preview] Wrote public JWKS to ${files.jwksPath}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
