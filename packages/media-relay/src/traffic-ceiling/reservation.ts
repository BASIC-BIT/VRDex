import {
  ConditionalCheckFailedException,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";

/** Existing S3 segment uploads reject files above this size. This is an intentionally
 * pessimistic prototype charge, not a practical production segment allowance. */
export const MAX_SEGMENT_PAYLOAD_BYTES = 32 * 1024 * 1024;

export type ReservationResult =
  | { allowed: true }
  | { allowed: false; reason: "exhausted-or-closed" | "unavailable" };

type UpdateClient = {
  send(
    command: UpdateItemCommand,
    options: { abortSignal: AbortSignal },
  ): Promise<unknown>;
};

/** One conditional write is the linearization point for a delivery's payload and
 * accepted-request allowance. No local cache or read-before-write is permitted. */
export function createTrafficReservation(options: {
  client: UpdateClient;
  tableName: string;
  deliveryId: string;
  generation: string;
  deadlineMs?: number;
}) {
  const deadlineMs = options.deadlineMs ?? 1500;
  if (
    !/^[A-Za-z0-9_.-]{3,255}$/.test(options.tableName) ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(options.deliveryId) ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(options.generation) ||
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 1 ||
    deadlineMs > 5000
  )
    throw Error("Invalid traffic reservation configuration");

  return async (): Promise<ReservationResult> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(Error("Traffic reservation timed out"));
      }, deadlineMs);
    });
    try {
      await Promise.race([
        options.client.send(
          new UpdateItemCommand({
            TableName: options.tableName,
            Key: { deliveryId: { S: options.deliveryId } },
            UpdateExpression:
              "SET #bytes = #bytes - :bytes, #requests = #requests - :one",
            ConditionExpression:
              "#status = :open AND #generation = :generation AND #bytes >= :bytes AND #requests >= :one",
            ExpressionAttributeNames: {
              "#bytes": "remainingPayloadBytes",
              "#requests": "remainingRequests",
              "#status": "status",
              "#generation": "generation",
            },
            ExpressionAttributeValues: {
              ":bytes": { N: String(MAX_SEGMENT_PAYLOAD_BYTES) },
              ":one": { N: "1" },
              ":open": { S: "open" },
              ":generation": { S: options.generation },
            },
            ReturnValues: "NONE",
          }),
          { abortSignal: controller.signal },
        ),
        timeout,
      ]);
      return { allowed: true };
    } catch (error) {
      return error instanceof ConditionalCheckFailedException
        ? { allowed: false, reason: "exhausted-or-closed" }
        : { allowed: false, reason: "unavailable" };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
