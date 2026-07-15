import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stringifyOpenApiDocument, stringifyOpenApiYamlDocument } from "./openapi";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonOutputPath = path.resolve(packageRoot, "../../docs/api/openapi.json");
const yamlOutputPath = path.resolve(packageRoot, "../../docs/api/openapi.yaml");

await mkdir(path.dirname(jsonOutputPath), { recursive: true });
await Promise.all([
  writeFile(jsonOutputPath, stringifyOpenApiDocument(), "utf8"),
  writeFile(yamlOutputPath, stringifyOpenApiYamlDocument(), "utf8"),
]);
