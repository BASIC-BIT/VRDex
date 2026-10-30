import { z } from "zod";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  S3ServiceException,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { RelayStorage } from "../worker/publisher";
import { PublishedSnapshotSchema } from "../contracts";
import { boundedJson, deadline } from "./transport";
function key(value: string) {
  if (
    !/^vrcdn\/[a-zA-Z0-9_-]+\/1\/epochs\/[1-9][0-9]*\/(?:[a-zA-Z0-9_-]+\/(?:video|audio)-[0-9]+\.ts|snapshots\/(?:video|audio)-[0-9]+\.json)$/.test(
      value,
    )
  )
    throw Error("Invalid media key");
  return value;
}
export function createAwsStorage(
  client: S3Client,
  bucket: string,
  {
    maxCachedUploads = 16384,
    cursorKey,
  }: { maxCachedUploads?: number; cursorKey?: string } = {},
): RelayStorage & {
  readSnapshot(args: {
    objectKey: string;
    signal: AbortSignal;
  }): Promise<unknown>;
} {
  if (!bucket) throw Error("Missing bucket");
  let cursor: string | undefined;
  let cursorLoaded = false;
  if (
    cursorKey &&
    !/^_relay\/retirement\/[a-zA-Z0-9_-]{1,128}\.json$/.test(cursorKey)
  )
    throw Error("Invalid cursor key");
  if (
    !Number.isSafeInteger(maxCachedUploads) ||
    maxCachedUploads < 1 ||
    maxCachedUploads > 32768
  )
    throw Error("Invalid upload cache bound");
  const completed = new Map<
    string,
    { hash: string; length: number; at: number }
  >();
  async function put(
    objectKey: string,
    body: string | ReturnType<typeof createReadStream>,
    length: number,
    hash: string,
    signal: AbortSignal,
    contentType: string,
  ) {
    const abortSignal = deadline(signal, 4500);
    const previous = completed.get(objectKey);
    if (previous && Date.now() - previous.at < 600000) {
      if (typeof body !== "string") body.destroy();
      if (previous.hash !== hash || previous.length !== length)
        throw Error("Immutable media conflict");
      completed.delete(objectKey);
      completed.set(objectKey, previous);
      return;
    }
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key(objectKey),
          Body: body,
          ContentLength: length,
          ContentType: contentType,
          IfNoneMatch: "*",
          Metadata: { sha256: hash },
        }),
        { abortSignal },
      );
    } catch (error) {
      if (
        !(error instanceof S3ServiceException) ||
        error.$metadata.httpStatusCode !== 412
      )
        throw Error("Media upload failed");
      const existing = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key(objectKey) }),
        { abortSignal },
      );
      if (
        existing.Metadata?.sha256 !== hash ||
        existing.ContentLength !== length
      )
        throw Error("Immutable media conflict");
    } finally {
      if (typeof body !== "string") body.destroy();
    }
    completed.delete(objectKey);
    completed.set(objectKey, { hash, length, at: Date.now() });
    if (completed.size > maxCachedUploads) {
      const oldest = completed.keys().next().value;
      if (oldest !== undefined) completed.delete(oldest);
    }
  }
  return {
    async putSegment({ objectKey, filePath, signal }) {
      signal.throwIfAborted();
      const size = (await stat(filePath)).size;
      if (size < 1 || size > 32 * 1024 * 1024)
        throw Error("Segment size exceeded");
      const hash = createHash("sha256");
      const input = createReadStream(filePath, { signal });
      for await (const chunk of input) hash.update(chunk);
      await put(
        objectKey,
        createReadStream(filePath, { signal }),
        size,
        hash.digest("hex"),
        signal,
        "video/mp2t",
      );
    },
    async putSnapshot({ objectKey, snapshot, signal }) {
      const body = JSON.stringify(PublishedSnapshotSchema.parse(snapshot));
      if (Buffer.byteLength(body) > 131072)
        throw Error("Snapshot size exceeded");
      await put(
        objectKey,
        body,
        Buffer.byteLength(body),
        createHash("sha256").update(body).digest("hex"),
        signal,
        "application/json",
      );
    },
    async readSnapshot({ objectKey, signal }) {
      const abortSignal = deadline(signal);
      const reply = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key(objectKey) }),
        { abortSignal },
      );
      if (!reply.Body) throw Error("Missing snapshot");
      return PublishedSnapshotSchema.parse(
        await boundedJson(
          new Response(reply.Body.transformToWebStream()),
          131072,
          abortSignal,
        ),
      );
    },
    async retire({ before, limit, signal }) {
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 1000 ||
        !Number.isFinite(before)
      )
        throw Error("Invalid retirement bounds");
      const abortSignal = deadline(signal, 4500);
      if (cursorKey && !cursorLoaded) {
        const checkpoint = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: cursorKey,
            MaxKeys: 1,
          }),
          { abortSignal },
        );
        if (checkpoint.Contents?.some((object) => object.Key === cursorKey)) {
          const saved = await client.send(
            new GetObjectCommand({ Bucket: bucket, Key: cursorKey }),
            { abortSignal },
          );
          if (!saved.Body) throw Error("Missing retirement checkpoint");
          const parsed = z
            .strictObject({ cursor: z.string().max(4096).nullable() })
            .parse(
              await boundedJson(
                new Response(saved.Body.transformToWebStream()),
                8192,
                abortSignal,
              ),
            );
          cursor = parsed.cursor ?? undefined;
        }
        cursorLoaded = true;
      }
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: "vrcdn/",
          MaxKeys: limit,
          ContinuationToken: cursor,
        }),
        { abortSignal },
      );
      const objects = (page.Contents ?? [])
        .filter(
          (o) => o.Key && o.LastModified && o.LastModified.getTime() < before,
        )
        .map((o) => ({ Key: o.Key }));
      if (objects.length) {
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objects, Quiet: true },
          }),
          { abortSignal },
        );
        if (result.Errors?.length) throw Error("Media retirement failed");
      }
      cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && !cursor) throw Error("Missing retirement cursor");
      if (cursorKey)
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: cursorKey,
            Body: JSON.stringify({ cursor: cursor ?? null }),
            ContentType: "application/json",
          }),
          { abortSignal },
        );
    },
  };
}
