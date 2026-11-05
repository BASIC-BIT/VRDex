import { z } from "zod";
import { WorkerObservationSchema, WorkerAllocationSchema } from "../contracts";
export const WorkerBindingSchema = z.strictObject({
  workerId: WorkerObservationSchema.shape.workerId,
  workerEpoch: WorkerObservationSchema.shape.workerEpoch,
  allocation: WorkerAllocationSchema,
  maxSources: z.number().int().min(1).max(1000),
  draining: z.boolean(),
});
export const WorkerBindingsSchema = z
  .array(WorkerBindingSchema)
  .max(1000)
  .refine(
    (bindings) =>
      new Set(bindings.map((binding) => binding.workerId)).size ===
      bindings.length,
    "Relay worker IDs must be unique, including across epochs",
  );
export type WorkerBinding = z.infer<typeof WorkerBindingSchema>;
