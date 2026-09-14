import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";

it("seals the single-read candidate despite quarantine overwrites and returns the same receipt on replay", () => {
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import sharp from "sharp";
    import { getFunctionName } from "convex/server";
    import { createMcpMediaUploadHandlers, assertLocalUploadCandidate } from "./apps/web/src/lib/server/mcp-media-upload.ts";
    import { profileAssetUploadChecksum } from "./apps/web/src/lib/server/profile-asset-storage.ts";
    const original = await sharp({ create: { width: 16, height: 16, channels: 4, background: "red" } }).png().toBuffer();
    const replacement = await sharp({ create: { width: 16, height: 16, channels: 4, background: "blue" } }).png().toBuffer();
    const declaration = { byteLength: original.length, contentType: "image/png", sha256: profileAssetUploadChecksum(original) };
    for (const object of [null, { body: replacement, contentType: "image/png" }, { body: original, contentType: "image/jpeg" }, { body: original, contentType: "image/png", contentLength: original.length + 1 }]) {
      assert.throws(() => assertLocalUploadCandidate(object, declaration), /SOURCE_MISMATCH/);
    }
    let quarantine = original, reads = 0, receipt;
    const stored = new Map();
    const handler = createMcpMediaUploadHandlers({
      authority: async () => ({ actorUserId: "user", oauthClientId: "client", oauthTokenId: "token", emailVerified: true, emailVerificationAttestedAt: Date.now() }),
      admin: { mutation: async (fn, args) => {
        switch (getFunctionName(fn)) {
          case "contributionUploads:begin": return { intentId: "intent", expiresAt: Date.now() + 600000, quarantineStorageKey: "quarantine", contentType: "image/png", byteLength: original.length };
          case "contributionUploads:claim": return receipt ? { receipt } : { intentId: "intent", quarantineStorageKey: "quarantine", sourceStorageKey: "source", downloadStorageKey: "download", storageKey: "display", ...declaration };
          case "contributionUploads:complete":
            assert.equal(args.sourceContentSha256, declaration.sha256);
            receipt = { operationId: "intent", operationState: "committed", resourceId: "proposal" }; return receipt;
          default: throw new Error("Unexpected mutation");
        }
      } },
      target: async ({ storageKey }) => ({ url: "https://bucket.example.test/", fields: { key: storageKey, policy: "signed" } }),
      read: async () => { reads++; const body = quarantine; quarantine = replacement; return { body, contentType: "image/png" }; },
      put: async ({ storageKey, body }) => { if (stored.has(storageKey)) assert.deepEqual(stored.get(storageKey), body); else stored.set(storageKey, body); },
    });
    const target = await handler.begin({ mode: "contributor", profileId: "profile", expectedUpdatedAt: 1, placement: "profile_image", ...declaration, credit: "Artist", sourceDescription: "Artist local original", idempotencyKey: "begin" });
    assert.deepEqual(Object.keys(target).sort(), ["expiresAt", "intentId", "transfer"]);
    assert.deepEqual(target.transfer.fields, { key: "quarantine", policy: "signed" });
    assert.equal(target.transfer.fileField, "file");
    assert.equal(target.transfer.method, "POST");
    const result = await handler.complete({ intentId: "intent", idempotencyKey: "complete" });
    quarantine = replacement;
    assert.deepEqual(await handler.complete({ intentId: "intent", idempotencyKey: "complete" }), result);
    assert.equal(reads, 1);
    assert.deepEqual(stored.get("source"), original);
    assert.equal(stored.size, 3);
    let failedToken;
    const uncertain = createMcpMediaUploadHandlers({
      authority: async () => ({ actorUserId: "user", oauthClientId: "client", oauthTokenId: "token", emailVerified: true, emailVerificationAttestedAt: Date.now() }),
      admin: { mutation: async (fn, args) => {
        if (getFunctionName(fn) === "contributionUploads:claim") return { intentId: "intent", quarantineStorageKey: "quarantine", sourceStorageKey: "source", downloadStorageKey: "download", storageKey: "display", ...declaration };
        if (getFunctionName(fn) === "contributionUploads:complete") throw new Error("Commit response lost");
        if (getFunctionName(fn) === "contributionUploads:fail") { failedToken = args.processingToken; return null; }
        throw new Error("Unexpected mutation");
      } },
      read: async () => ({ body: original, contentType: "image/png" }),
      put: async () => {},
    });
    await assert.rejects(uncertain.complete({ intentId: "intent", idempotencyKey: "complete" }), /COMPLETION_UNCERTAIN/);
    assert.equal(typeof failedToken, "string", "An uncertain finalization must release processing through the receipt-preserving fail transaction");
  `], { cwd: process.cwd(), env: { ...process.env, TSX_TSCONFIG_PATH: "apps/web/tsconfig.json" }, stdio: "pipe" });
});

import {
  profileAssetMimeTypeForFile,
  profileAssetUploadSource,
} from "../../apps/web/src/lib/server/profile-asset-validation";

describe("profile asset upload route MIME fallback", () => {
  it("infers every supported file type when multipart MIME is empty", () => {
    assert.equal(profileAssetMimeTypeForFile("", "image.png"), "image/png");
    assert.equal(profileAssetMimeTypeForFile("", "image.jpg"), "image/jpeg");
    assert.equal(profileAssetMimeTypeForFile("", "image.webp"), "image/webp");
    assert.equal(profileAssetMimeTypeForFile("", "image.svg"), "image/svg+xml");
  });

  it("preserves declared MIME and generic fallback behavior", () => {
    assert.equal(profileAssetMimeTypeForFile("image/webp", "image.png"), "image/webp");
    assert.equal(
      profileAssetMimeTypeForFile("application/octet-stream", "image.svg"),
      "image/svg+xml",
    );
  });

  it("uses a submitted file before an evidence source URL", () => {
    assert.equal(profileAssetUploadSource("multipart/form-data; boundary=test", true), "multipart");
    assert.equal(profileAssetUploadSource("application/json", true), "source_url");
    assert.equal(profileAssetUploadSource("application/octet-stream", false), "direct");
  });
});

it("reserves URL imports before fetching and seals them through the same upload lifecycle",()=>{
 execFileSync(process.execPath,["--import","tsx","--input-type=module","-e",`
 import assert from "node:assert/strict";
 import sharp from "sharp";
 import {getFunctionName} from "convex/server";
 import {createMcpMediaUploadHandlers} from "./apps/web/src/lib/server/mcp-media-upload.ts";
 import {profileAssetUploadChecksum} from "./apps/web/src/lib/server/profile-asset-storage.ts";
 const bytes=await sharp({create:{width:8,height:8,channels:4,background:"red"}}).png().toBuffer();
 const declaration={byteLength:bytes.length,contentType:"image/png",sha256:profileAssetUploadChecksum(bytes)};
 const objects=new Map();let admitted=false,fetches=0,authorizations=0;
 const handlers=createMcpMediaUploadHandlers({authority:async()=>{authorizations++;return {actorUserId:"actor",oauthClientId:"client",oauthTokenId:"token",emailVerified:true,emailVerificationAttestedAt:Date.now()};},
 admin:{mutation:async(fn,args)=>{switch(getFunctionName(fn)){
 case "contributionUploads:begin":admitted=true;assert.equal(args.placement,"primary_logo");return {intentId:"intent",quarantineStorageKey:"quarantine",expiresAt:Date.now()+600000,contentType:"image/png",byteLength:bytes.length};
 case "contributionUploads:claim":return {intentId:"intent",quarantineStorageKey:"quarantine",sourceStorageKey:"source",downloadStorageKey:"download",storageKey:"display",...declaration};
 case "contributionUploads:complete":return {operationId:"intent",operationState:"committed",resourceId:"submission"};
 default:throw Error("unexpected");}}},
 fetchSource:async()=>{assert.equal(admitted,true);fetches++;return {body:bytes,mimeType:"image/png"};},
 put:async({storageKey,body})=>{objects.set(storageKey,body);},read:async(key)=>({body:objects.get(key),contentType:"image/png"})});
 const result=await handlers.importUrl({mode:"contributor",profileId:"club",expectedUpdatedAt:1,placement:"primary_logo",...declaration,credit:"Artist",sourceUrl:"https://example.test/logo.png",sourceDescription:"Public artist image",idempotencyKey:"key"});
 assert.equal(result.operationState,"committed");assert.equal(fetches,1);assert.equal(authorizations,3);assert.equal(objects.size,4);
 `],{cwd:process.cwd(),env:{...process.env,TSX_TSCONFIG_PATH:"apps/web/tsconfig.json"},stdio:"pipe"});
});
