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

export function createRateLimitProblem(retryAfterSeconds: number) {
  return createApiProblem({
    status: 429,
    title: "Too many requests",
    detail: `Retry after ${retryAfterSeconds} seconds.`,
  });
}
