import { z } from "zod";
import { WorkerBindingSchema } from "../worker/deployment";
const positive = z.number().int().positive();
const secret = z
  .string()
  .regex(/^arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:.+$/);
const origin = z.url().refine((v) => {
  const u = new URL(v);
  return u.protocol === "https:" && u.origin === v;
});
export const DeploymentSchema = z.discriminatedUnion("enabled", [
  z.strictObject({ version: z.literal(1), enabled: z.literal(false) }),
  z.strictObject({
    version: z.literal(1),
    enabled: z.literal(true),
    region: z.string().min(1),
    controlUrl: origin,
    credentialRef: secret,
    bucket: z.string().min(3),
    demandTable: z.string().min(3),
    globalSourceCap: positive.max(1000),
    gatewayConcurrency: positive.max(1000),
    admissionPerMinute: positive,
    trafficGiBPerMonth: positive,
    releaseEvidence: z.string().min(8),
    origins: z.array(origin).min(1).max(20),
    distributionOrigin: origin,
    signingKeyId: z.string().min(1),
    signingKeyRef: secret,
    binding: WorkerBindingSchema.optional(),
  }),
]);
export function parseDeployment(env: NodeJS.ProcessEnv) {
  return DeploymentSchema.parse(
    JSON.parse(env.MEDIA_RELAY_CONFIG ?? '{"version":1,"enabled":false}'),
  );
}
