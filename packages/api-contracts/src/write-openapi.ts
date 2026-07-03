import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stringifyOpenApiDocument } from "./openapi";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.resolve(packageRoot, "../../docs/api/openapi.json");

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, stringifyOpenApiDocument(), "utf8");
