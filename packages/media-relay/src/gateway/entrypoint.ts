import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { parseDeployment } from "../providers/config";
import { readSecret } from "../providers/secrets";
import {
  createControlRpc,
  gatewayAuthorization,
} from "../providers/convex-control";
import { createAwsStorage } from "../providers/aws-storage";
import { createAwsDemand } from "../providers/aws-demand";
import { createDemand } from "./demand";
import { createManifestHandler, createLambdaHandler } from "./handler";
import { createSegmentSigner } from "./signing";
let initialized: Promise<ReturnType<typeof createLambdaHandler>> | undefined;
async function initialize() {
  const config = parseDeployment(process.env);
  if (!config.enabled)
    return createLambdaHandler(async () => new Response(null, { status: 503 }));
  const [credential, privateKey] = await Promise.all([
    readSecret(config.region, config.credentialRef),
    readSecret(config.region, config.signingKeyRef),
  ]);
  const s3 = new S3Client({ region: config.region, maxAttempts: 1 });
  const dynamo = new DynamoDBClient({ region: config.region, maxAttempts: 1 });
  return createLambdaHandler(
    createManifestHandler({
      authorize: gatewayAuthorization(
        createControlRpc({ url: config.controlUrl, credential }),
      ),
      readSnapshot: createAwsStorage(s3, config.bucket).readSnapshot,
      demand: createDemand({
        store: createAwsDemand(dynamo, config.demandTable),
        clock: Date.now,
        maxEntries: config.globalSourceCap,
      }),
      signSegment: createSegmentSigner({
        origin: config.distributionOrigin,
        keyPairId: config.signingKeyId,
        privateKey,
        clock: Date.now,
      }),
      clock: Date.now,
      origins: config.origins,
      maxSources: config.globalSourceCap,
      maxConcurrent: config.gatewayConcurrency,
    }),
  );
}
export async function handler(event: unknown) {
  try {
    initialized ??= initialize().catch(() => {
      initialized = undefined;
      throw Error("Gateway unavailable");
    });
    return await (
      await initialized
    )(event);
  } catch {
    return {
      statusCode: 503,
      headers: { "Cache-Control": "no-store" },
      body: "",
      isBase64Encoded: false,
    };
  }
}
