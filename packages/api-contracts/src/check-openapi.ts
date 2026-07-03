import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stringifyOpenApiDocument } from "./openapi";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.resolve(packageRoot, "../../docs/api/openapi.json");
const expected = stringifyOpenApiDocument();
const actual = await readFile(outputPath, "utf8").catch((error: unknown) => {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    throw new Error(`Missing generated OpenAPI artifact: ${outputPath}`);
  }

  throw error;
});

if (actual !== expected) {
  throw new Error("docs/api/openapi.json is stale. Run pnpm generate:api-openapi.");
}
