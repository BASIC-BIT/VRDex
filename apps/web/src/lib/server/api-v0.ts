import {
  ApiProblemSchema,
  createBearerTokenQueryProblem,
  createPublicNotFoundProblem,
  hasBearerTokenInUrl,
} from "@vrdex/api-contracts";
import { NextResponse } from "next/server";

type ApiResponseSchema = {
  parse: (value: unknown) => unknown;
};

export function rejectBearerTokenQuery(request: Request) {
  if (!hasBearerTokenInUrl(request.url)) {
    return null;
  }

  return apiProblemResponse(createBearerTokenQueryProblem());
}

export function apiJson(schema: ApiResponseSchema, value: unknown) {
  return NextResponse.json(schema.parse(value));
}

export function apiProblemResponse(problem: unknown) {
  const parsed = ApiProblemSchema.parse(problem);

  return NextResponse.json(parsed, { status: parsed.status });
}

export function publicNotFoundResponse(resourceName: string) {
  return apiProblemResponse(createPublicNotFoundProblem(resourceName));
}

export function parseBoundedLimit(searchParams: URLSearchParams, options: { fallback: number; max: number }) {
  const rawLimit = searchParams.get("limit");

  if (rawLimit === null || rawLimit.trim() === "") {
    return options.fallback;
  }

  const limit = Number(rawLimit);

  if (!Number.isInteger(limit)) {
    return options.fallback;
  }

  return Math.max(1, Math.min(limit, options.max));
}
