/** Opt-in storage proof. See docs/testing/local-media-upload.md before running. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  createProfileAssetDirectUploadTarget,
  deleteProfileAssetObjects,
  getProfileAssetObject,
  putProfileAssetObject,
  profileAssetUploadChecksum,
} from "../apps/web/src/lib/server/profile-asset-storage";
import { validateAndPrepareProfileAsset } from "../apps/web/src/lib/server/profile-asset-validation";

async function main() {
  const approvedBucket = process.argv
    .find((arg) => arg.startsWith("--approved-test-bucket="))
    ?.split("=")[1];
  const bucket = process.env.VRDEX_PROFILE_ASSET_BUCKET;
  if (
    !approvedBucket ||
    approvedBucket !== bucket ||
    process.env.VRDEX_MEDIA_PROOF_CONFIRM !== "dedicated-test-bucket"
  ) {
    throw new Error(
      "Provide an explicitly approved dedicated test bucket and VRDEX_MEDIA_PROOF_CONFIRM=dedicated-test-bucket. No storage requests made.",
    );
  }
  if (!process.env.VRDEX_PROFILE_ASSET_REGION)
    throw new Error("Set the dedicated test region explicitly.");
  const prefix = `profile-assets/proof/local-upload/${randomUUID()}`;
  const keys = ["quarantine", "source", "download", "display"].map(
    (name) => `${prefix}/${name}`,
  );
  const original = await sharp({
    create: { width: 16, height: 16, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
  const overwritten = Buffer.from(original);
  overwritten[overwritten.length - 1] ^= 1;
  const transfer = await createProfileAssetDirectUploadTarget({
    storageKey: keys[0],
    contentType: "image/png",
    byteSize: original.length,
    expiresAt: Date.now() + 120_000,
  });
  async function post(body: Uint8Array) {
    const form = new FormData();
    for (const [name, value] of Object.entries(transfer.fields))
      form.append(name, value);
    form.append(
      "file",
      new Blob([new Uint8Array(body)], { type: "image/png" }),
      "synthetic.png",
    );
    // Only the signed form goes to S3. No application credentials or cookies.
    return await fetch(transfer.url, {
      method: "POST",
      body: form,
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  }
  try {
    assert.ok((await post(original)).ok, "Initial multipart transfer failed");
    assert.ok((await post(overwritten)).ok, "Pre-seal overwrite failed");
    assert.notEqual(
      profileAssetUploadChecksum((await getProfileAssetObject(keys[0]))!.body),
      profileAssetUploadChecksum(original),
    );
    assert.ok((await post(original)).ok, "Restore transfer failed");
    const candidate = (await getProfileAssetObject(keys[0]))!;
    assert.equal(
      profileAssetUploadChecksum(candidate.body),
      profileAssetUploadChecksum(original),
    );
    const prepared = await validateAndPrepareProfileAsset(
      candidate.body,
      candidate.contentType,
    );
    const parts = [prepared.source, prepared.download, prepared.display];
    for (let i = 0; i < parts.length; i++) {
      const upload = {
        storageKey: keys[i + 1],
        body: parts[i].body,
        contentType: parts[i].mimeType,
        cacheControl: "private, no-store",
      };
      await putProfileAssetObject(upload);
      await putProfileAssetObject(upload);
    }
    await assert.rejects(
      putProfileAssetObject({
        storageKey: keys[1],
        body: overwritten,
        contentType: "image/png",
      }),
    );
    assert.ok((await post(overwritten)).ok, "Post-seal overwrite failed");
    assert.deepEqual(
      (await getProfileAssetObject(keys[1]))!.body,
      new Uint8Array(original),
    );
    assert.equal(
      (await post(new Uint8Array(original.length + 1))).ok,
      false,
      "S3 must reject undeclared size",
    );
    console.log(
      JSON.stringify({
        bucket,
        prefix,
        multipart: "passed",
        reusableForm: "passed",
        immutableSeal: "passed",
        sizeBound: "passed",
        databaseReceipt: "covered separately by backend tests",
      }),
    );
  } finally {
    // All keys are generated under this run's random prefix. Never accept input keys.
    await deleteProfileAssetObjects(keys);
  }
}
void main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Storage proof failed",
  );
  process.exitCode = 1;
});
