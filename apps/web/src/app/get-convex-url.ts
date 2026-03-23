import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function readConvexUrlFromEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return undefined;
  }

  const file = readFileSync(filePath, "utf8");
  const lines = file.split(/\r?\n/);

  for (const key of ["NEXT_PUBLIC_CONVEX_URL", "CONVEX_URL"]) {
    const match = lines.find((line) => line.startsWith(`${key}=`));

    if (match) {
      return match.slice(key.length + 1);
    }
  }

  return undefined;
}

export function getConvexUrl() {
  const localCandidates = [
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), "../../.env.local"),
  ];

  for (const candidate of localCandidates) {
    const value = readConvexUrlFromEnvFile(candidate);

    if (value) {
      return value;
    }
  }

  return process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
}
