import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { ConvexHttpClient } from 'convex/browser';
import { loadConfig, runBridge } from './event-media-ecs-bridge.mjs';
import { createEcsSdkRunner } from './event-media-ecs-sdk.mjs';

let runtime;
async function loadRuntime() {
  // Node.js 22 Lambda supplies SDK v3. Keep imports deferred for offline tooling.
  runtime ??= Promise.all([
    import('@aws-sdk/client-ecs'),
    import('@aws-sdk/client-secrets-manager'),
  ]).then(([ecsCommands, secretCommands]) => ({
    ecsCommands,
    secretCommands,
    ecsClient: new ecsCommands.ECSClient({ maxAttempts: 1 }),
    secretsClient: new secretCommands.SecretsManagerClient({ maxAttempts: 1 }),
  }));
  return runtime;
}

async function readToken({ secretsClient, secretCommands }, secretArn, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const result = await secretsClient.send(
      new secretCommands.GetSecretValueCommand({ SecretId: secretArn }),
      { abortSignal: controller.signal },
    );
    if (typeof result.SecretString !== 'string' || !result.SecretString.trim()) throw Error('Invalid service token.');
    return result.SecretString;
  } finally {
    clearTimeout(timeout);
  }
}

export function createLambdaHandler(dependencies = {}) {
  const {
    loadRuntime: getRuntime = loadRuntime,
    loadConfig: getConfig = loadConfig,
    runBridge: bridgePass = runBridge,
    fetch: request = globalThis.fetch,
    logger = console,
    timeoutMs = 15_000,
  } = dependencies;

  return async (_event, context = {}) => {
    try {
      // Refuse even malformed/empty inherited values before loadConfig parses
      // them. An invocation lifecycle must never become global media drain.
      if (process.env.VRDEX_EVENT_MEDIA_BRIDGE_DRAIN_AT_MS !== undefined) throw Error('Lambda cannot inherit a drain deadline.');
      const secretArn = process.env.VRDEX_EVENT_MEDIA_WORKER_TOKEN_SECRET_ARN?.trim();
      if (!secretArn) throw Error('Service token secret is required.');
      const sdk = await getRuntime();
      const bridgeToken = await readToken(sdk, secretArn, timeoutMs);
      const config = {
        ...getConfig({ bridgeToken }),
        workerId: `event-media-lambda-${context.awsRequestId || randomUUID()}`,
        once: true,
        drainAtMs: undefined,
      };
      const boundedFetch = (input, init = {}) => {
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const callerSignal = init.signal ?? (input instanceof Request ? input.signal : undefined);
        const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
        // Keep the signal active through response body consumption as well.
        return request(input, { ...init, signal });
      };
      const client = new ConvexHttpClient(config.convexUrl, { fetch: boundedFetch, logger: false });
      const runAws = createEcsSdkRunner({ client: sdk.ecsClient, commands: sdk.ecsCommands, timeoutMs });
      // The existing CLI owns process signal drain semantics. Lambda uses an
      // isolated signal emitter with no expiration or process handlers.
      await bridgePass(client, config, runAws, { signals: new EventEmitter() });
      logger.info(JSON.stringify({ event: 'event_media_dispatcher_invocation', outcome: 'completed' }));
      return { outcome: 'completed' };
    } catch {
      logger.error(JSON.stringify({ event: 'event_media_dispatcher_invocation', outcome: 'failed' }));
      throw Error('Event media dispatcher invocation failed.');
    }
  };
}

export const handler = createLambdaHandler();
