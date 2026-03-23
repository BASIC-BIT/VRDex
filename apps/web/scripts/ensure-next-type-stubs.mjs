import { existsSync, mkdirSync, writeFileSync } from "node:fs";

mkdirSync(".next/types", { recursive: true });

const cacheLifeStub = ".next/types/cache-life.d.ts";

if (!existsSync(cacheLifeStub)) {
  writeFileSync(cacheLifeStub, "export {};");
}
