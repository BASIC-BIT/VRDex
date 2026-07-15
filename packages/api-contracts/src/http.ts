export const apiVersion = "v0";

export type ApiProblemInput = {
  detail?: string;
  instance?: string;
  status: number;
  title: string;
  type?: string;
};

export function createApiProblem(input: ApiProblemInput) {
  return {
    type: input.type ?? "about:blank",
    title: input.title,
    status: input.status,
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.instance ? { instance: input.instance } : {}),
  };
}

export function createPublicNotFoundProblem(resourceName: string) {
  return createApiProblem({
    status: 404,
    title: `${resourceName} not found`,
    detail: "The requested public resource was not found.",
  });
}

export function createPublicDataUnavailableProblem(resourceName: string) {
  return createApiProblem({
    status: 503,
    title: `${resourceName} temporarily unavailable`,
    detail: "The requested public data is temporarily unavailable. Try again later.",
  });
}

export function createRateLimitProblem(retryAfterSeconds: number) {
  return createApiProblem({
    status: 429,
    title: "Too many requests",
    detail: `Retry after ${retryAfterSeconds} seconds.`,
  });
}

export function createBearerTokenQueryProblem() {
  return createApiProblem({
    status: 400,
    title: "Bearer token query parameters are not allowed",
    detail: "Send bearer credentials with the Authorization header instead of URL query parameters.",
  });
}
