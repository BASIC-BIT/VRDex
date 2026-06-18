import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

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

function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1" || process.env.VERCEL === "true" || Boolean(process.env.VERCEL_OIDC_TOKEN);
}

function vercelOidcRoleArn(): string | undefined {
  const roleArn = process.env.VRDEX_PROFILE_ASSET_ROLE_ARN ?? (isVercelRuntime() ? process.env.AWS_ROLE_ARN : undefined);
  const normalized = roleArn?.trim();

  return normalized ? normalized : undefined;
}

function storageConfig(): StorageConfig | null {
  const bucket = process.env.VRDEX_PROFILE_ASSET_BUCKET ?? process.env.VRDEX_ASSET_BUCKET;
  const region =
    process.env.VRDEX_PROFILE_ASSET_REGION ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;

  if (!bucket || !region) {
    return null;
  }

  return { bucket, region };
}

function s3Client(config: StorageConfig): S3Client {
  const roleArn = vercelOidcRoleArn();
  const cacheKey = `${config.region}:${roleArn ?? "default"}`;
  const cachedClient = cachedClients.get(cacheKey);

  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const client = new S3Client({
    region: config.region,
    ...(roleArn !== undefined ? { credentials: awsCredentialsProvider({ roleArn }) } : {}),
  });
  cachedClients.set(cacheKey, client);

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

  await s3Client(config).send(
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
    const object = await s3Client(config).send(
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
