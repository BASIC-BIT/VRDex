import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getOpenApiDocument, stringifyOpenApiDocument } from "./openapi";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.resolve(packageRoot, "../../docs/api/openapi.json");
const appApiRoot = path.resolve(packageRoot, "../../apps/web/src/app/api/v0");
const httpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const openApiHttpMethods = httpMethods.map((method) => method.toLowerCase());

type HttpMethod = (typeof httpMethods)[number];

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function findRouteFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (isEnoent(error)) {
      throw new Error(`Missing Next API route directory: ${directory}`);
    }

    throw error;
  });
  const routeFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return findRouteFiles(entryPath);
      }

      return entry.isFile() && entry.name === "route.ts" ? [entryPath] : [];
    }),
  );

  return routeFiles.flat();
}

function routeFileToOpenApiPath(routeFile: string): string {
  const routeDirectory = path.dirname(path.relative(appApiRoot, routeFile));
  const segments = routeDirectory === "." ? [] : routeDirectory.split(path.sep);
  const openApiSegments = segments.map((segment) => {
    const parameterMatch = segment.match(/^\[([^\]]+)\]$/);
    return parameterMatch?.[1] ? `{${parameterMatch[1]}}` : segment;
  });

  return `/api/v0${openApiSegments.length > 0 ? `/${openApiSegments.join("/")}` : ""}`;
}

function extractExportedHttpMethods(source: string): Set<HttpMethod> {
  const methods = new Set<HttpMethod>();
  const exportPatterns = [
    /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g,
    /export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b/g,
  ];

  for (const pattern of exportPatterns) {
    for (const match of source.matchAll(pattern)) {
      const method = match[1];
      if (httpMethods.includes(method as HttpMethod)) {
        methods.add(method as HttpMethod);
      }
    }
  }

  return methods;
}

async function assertOpenApiRouteParity() {
  const routeFiles = await findRouteFiles(appApiRoot);
  const routeMethodsByPath = new Map<string, Set<HttpMethod>>();

  for (const routeFile of routeFiles) {
    const routePath = routeFileToOpenApiPath(routeFile);
    const source = await readFile(routeFile, "utf8");
    routeMethodsByPath.set(routePath, extractExportedHttpMethods(source));
  }

  const openApiDocument = getOpenApiDocument();
  const openApiPaths = openApiDocument.paths ?? {};
  const missingOpenApiOperations: string[] = [];
  const missingRouteHandlers: string[] = [];

  for (const [routePath, routeMethods] of routeMethodsByPath) {
    const pathItem = openApiPaths[routePath] as Record<string, unknown> | undefined;

    for (const method of routeMethods) {
      if (pathItem?.[method.toLowerCase()] === undefined) {
        missingOpenApiOperations.push(`${method} ${routePath}`);
      }
    }
  }

  for (const [openApiPath, pathItem] of Object.entries(openApiPaths)) {
    if (!openApiPath.startsWith("/api/v0/")) {
      continue;
    }

    const routeMethods = routeMethodsByPath.get(openApiPath);
    const pathItemMethods = pathItem as Record<string, unknown>;

    for (const method of openApiHttpMethods) {
      if (pathItemMethods[method] !== undefined && !routeMethods?.has(method.toUpperCase() as HttpMethod)) {
        missingRouteHandlers.push(`${method.toUpperCase()} ${openApiPath}`);
      }
    }
  }

  if (missingOpenApiOperations.length > 0 || missingRouteHandlers.length > 0) {
    throw new Error(
      [
        "OpenAPI route parity failed.",
        missingOpenApiOperations.length > 0
          ? `Missing OpenAPI operations:\n${missingOpenApiOperations.map((operation) => `- ${operation}`).join("\n")}`
          : null,
        missingRouteHandlers.length > 0
          ? `Missing Next route handlers:\n${missingRouteHandlers.map((handler) => `- ${handler}`).join("\n")}`
          : null,
      ]
        .filter((line): line is string => line !== null)
        .join("\n\n"),
    );
  }
}

const expected = stringifyOpenApiDocument();
const actual = await readFile(outputPath, "utf8").catch((error: unknown) => {
  if (isEnoent(error)) {
    throw new Error(`Missing generated OpenAPI artifact: ${outputPath}`);
  }

  throw error;
});

if (actual !== expected) {
  throw new Error("docs/api/openapi.json is stale. Run pnpm generate:api-openapi.");
}

await assertOpenApiRouteParity();
