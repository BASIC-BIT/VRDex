import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type StorageConfig = {
  bucket: string;
  region: string;
};

type StoredObject = {
  body: Uint8Array;
  contentType: string;
  contentLength?: number;
};

const cachedClients = new Map<string, S3Client>();

function storageConfig(): StorageConfig | null {
  const bucket = process.env.VRDEX_PROFILE_ASSET_BUCKET ?? process.env.VRDEX_ASSET_BUCKET;
  const region =
    process.env.VRDEX_PROFILE_ASSET_REGION ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;

  if (!bucket || !region) {
    return null;
  }

  return { bucket, region };
}

function s3Client(region: string): S3Client {
  const cachedClient = cachedClients.get(region);

  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const client = new S3Client({ region });
  cachedClients.set(region, client);

  return client;
}

export function isProfileAssetStorageConfigured(): boolean {
  return storageConfig() !== null;
}

export async function putProfileAssetObject(input: {
  storageKey: string;
  body: Uint8Array;
  contentType: string;
}) {
  const config = storageConfig();

  if (config === null) {
    throw new Error("Profile asset storage is not configured.");
  }

  await s3Client(config.region).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: input.storageKey,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

export async function getProfileAssetObject(storageKey: string): Promise<StoredObject | null> {
  const config = storageConfig();

  if (config === null) {
    throw new Error("Profile asset storage is not configured.");
  }

  try {
    const object = await s3Client(config.region).send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: storageKey,
      }),
    );

    if (!object.Body) {
      return null;
    }

    return {
      body: await object.Body.transformToByteArray(),
      contentType: object.ContentType ?? "application/octet-stream",
      contentLength: object.ContentLength,
    };
  } catch (error) {
    const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";

    if (name === "NoSuchKey" || name === "NotFound") {
      return null;
    }

    throw error;
  }
}
