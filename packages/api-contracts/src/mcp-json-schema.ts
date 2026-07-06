import { z } from "./schemas";

export type McpJsonSchema = Record<string, unknown>;

const namedSchemaMapKeys = new Set(["$defs", "definitions", "dependentSchemas", "patternProperties", "properties"]);

function isJsonObject(value: unknown): value is McpJsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripLegacySchemaIds(value: unknown, insideNamedSchemaMap = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripLegacySchemaIds(item));
  }

  if (!isJsonObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "id" || insideNamedSchemaMap)
      .map(([key, child]) => [key, stripLegacySchemaIds(child, namedSchemaMapKeys.has(key))]),
  );
}

export function mcpOutputJsonSchemaForZodSchema(schema: z.ZodType): McpJsonSchema {
  const jsonSchema = stripLegacySchemaIds(
    z.toJSONSchema(schema, {
      io: "output",
      target: "draft-2020-12",
    }),
  );

  if (!isJsonObject(jsonSchema)) {
    throw new Error("MCP output schema generation expected a JSON Schema object.");
  }

  return jsonSchema;
}
