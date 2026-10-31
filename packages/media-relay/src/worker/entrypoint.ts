import { pathToFileURL } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { parseDeployment } from "../providers/config";
import { readSecret } from "../providers/secrets";
import {
  createControlRpc,
  createConvexControl,
} from "../providers/convex-control";
import { createAwsStorage } from "../providers/aws-storage";
import { createAwsDemand } from "../providers/aws-demand";
import { createDemand } from "../gateway/demand";
import { startRelayWorker } from "./main";
export const WORKER_SCRATCH_DIRECTORY = "/var/lib/media-relay";
export async function bootWorker(env: NodeJS.ProcessEnv = process.env) {
  const config = parseDeployment(env);
  if (!config.enabled) return undefined;
  if (!config.binding) throw Error("Missing verified worker binding");
  const credential = await readSecret(config.region, config.credentialRef);
  const s3 = new S3Client({ region: config.region, maxAttempts: 1 });
  const dynamo = new DynamoDBClient({ region: config.region, maxAttempts: 1 });
  const worker = startRelayWorker({
    binding: config.binding,
    directory: WORKER_SCRATCH_DIRECTORY,
    control: createConvexControl(
      createControlRpc({ url: config.controlUrl, credential }),
      config.binding,
    ),
    storage: createAwsStorage(s3, config.bucket, {
      cursorKey: `_relay/retirement/${config.binding.workerId}.json`,
    }),
    demand: createDemand({
      store: createAwsDemand(dynamo, config.demandTable),
      clock: Date.now,
      maxEntries: config.globalSourceCap,
    }),
    metrics: ({ kind }) =>
      process.stdout.write(JSON.stringify({ kind }) + "\n"),
  });
  const drain = () => worker.drain();
  process.on("SIGUSR1", drain);
  const stop = async () => {
    process.removeListener("SIGUSR1", drain);
    await worker.stop();
    s3.destroy();
    dynamo.destroy();
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
  return { ...worker, stop };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void bootWorker().catch(() => {
    process.stderr.write('{"kind":"relay_boot_failed"}\n');
    process.exitCode = 1;
  });
}
// Expose the same composition boundaries for local packaged-artifact verification.
export { startRelayWorker } from "./main";
export { createPackager } from "./packager";
export { createSourceRelay } from "../../../../workers/restream/source-relay.mjs";
