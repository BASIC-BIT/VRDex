import assert from "node:assert/strict";
import { createPrivateKey } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  createPreviewDeveloperRuntimeSecrets,
  previewDeveloperRuntimeSecretFiles,
  writePreviewDeveloperRuntimeSecrets,
} from "../../scripts/generate-preview-developer-runtime-secrets.mjs";

describe("preview developer runtime secret generation", () => {
  it("creates independent peppers and an RSA access-token signing key", () => {
    const values = createPreviewDeveloperRuntimeSecrets();
    const peppers = [values.apiTokenPepper, values.oauthClientSecretPepper, values.oauthRefreshTokenPepper];

    for (const pepper of peppers) {
      assert.match(pepper, /^[a-f0-9]{64}$/);
    }
    assert.equal(new Set(peppers).size, peppers.length);
    assert.equal(createPrivateKey(values.oauthAccessTokenSigningKey.replaceAll("\\n", "\n")).asymmetricKeyType, "rsa");
  });

  it("writes each secret to its own file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "vrdex-preview-developer-runtime-"));

    try {
      await writePreviewDeveloperRuntimeSecrets(directory);

      for (const fileName of Object.values(previewDeveloperRuntimeSecretFiles)) {
        assert.notEqual((await readFile(path.join(directory, fileName), "utf8")).trim(), "");
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
