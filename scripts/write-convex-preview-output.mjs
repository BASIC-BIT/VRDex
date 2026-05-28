import { appendFileSync } from "node:fs";

const outputPath = process.env.GITHUB_OUTPUT;
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL was not provided by Convex deploy.");
}

if (outputPath) {
  appendFileSync(outputPath, `convex_url=${convexUrl}\n`);
}

console.log(`Convex preview URL captured: ${convexUrl}`);
