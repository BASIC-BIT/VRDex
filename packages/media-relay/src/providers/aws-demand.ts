import {
  GetItemCommand,
  UpdateItemCommand,
  ConditionalCheckFailedException,
  type DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import type { DemandStore } from "../gateway/demand";
import { StreamKeySchema } from "../contracts";
import { deadline } from "./transport";
export function createAwsDemand(
  client: DynamoDBClient,
  table: string,
): DemandStore {
  if (!table) throw Error("Missing demand table");
  async function get(key: string) {
    return client.send(
      new GetItemCommand({
        TableName: table,
        Key: { streamKey: { S: key } },
        ConsistentRead: true,
      }),
      { abortSignal: deadline() },
    );
  }
  return {
    async checkHealth() {
      await get("_health");
    },
    async read(key) {
      StreamKeySchema.parse(key);
      const reply = await get(key);
      const value = reply.Item?.lastActivityAt?.N;
      if (value === undefined) return null;
      const at = Number(value);
      if (!Number.isSafeInteger(at) || at < 0)
        throw Error("Invalid stored demand");
      return at;
    },
    async updateMax({ streamKey, at }) {
      StreamKeySchema.parse(streamKey);
      if (!Number.isSafeInteger(at) || at < 0) throw Error("Invalid demand");
      try {
        await client.send(
          new UpdateItemCommand({
            TableName: table,
            Key: { streamKey: { S: streamKey } },
            UpdateExpression: "SET lastActivityAt = :at",
            ConditionExpression:
              "attribute_not_exists(lastActivityAt) OR lastActivityAt < :at",
            ExpressionAttributeValues: { ":at": { N: String(at) } },
          }),
          { abortSignal: deadline() },
        );
      } catch (error) {
        if (!(error instanceof ConditionalCheckFailedException))
          throw Error("Demand unavailable");
      }
    },
  };
}
