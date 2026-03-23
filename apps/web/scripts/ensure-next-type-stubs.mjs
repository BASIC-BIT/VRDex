import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const nextTypesDir = path.join(webRoot, ".next", "types");
const cacheLifeStub = path.join(nextTypesDir, "cache-life.d.ts");

mkdirSync(nextTypesDir, { recursive: true });

if (!existsSync(cacheLifeStub)) {
  writeFileSync(cacheLifeStub, "export {};");
}
