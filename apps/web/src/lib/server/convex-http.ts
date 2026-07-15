import { ConvexHttpClient } from "convex/browser";
import type { HttpMutationOptions } from "convex/browser";
import type {
  ArgsAndOptions,
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from "convex/server";

type ConvexHttpClientWithAdminAuth = ConvexHttpClient & {
  query<Query extends FunctionReference<"query", "public" | "internal">>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ): Promise<FunctionReturnType<Query>>;
  mutation<Mutation extends FunctionReference<"mutation", "public" | "internal">>(
    mutation: Mutation,
    ...args: ArgsAndOptions<Mutation, HttpMutationOptions>
  ): Promise<FunctionReturnType<Mutation>>;
  setAdminAuth(token: string): void;
};

export function convexHttpClient() {
  const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!convexUrl) {
    throw new Error("Convex URL is not configured.");
  }

  return new ConvexHttpClient(convexUrl);
}

function convexAdminToken() {
  const token =
    process.env.CONVEX_ADMIN_TOKEN?.trim() ||
    process.env.CONVEX_DEPLOY_KEY?.trim() ||
    process.env.CONVEX_SELF_HOSTED_ADMIN_KEY?.trim();

  if (!token) {
    throw new Error("CONVEX_ADMIN_TOKEN is required for server-side internal Convex calls.");
  }

  return token;
}

export function convexAdminHttpClient() {
  const client = convexHttpClient() as ConvexHttpClientWithAdminAuth;

  client.setAdminAuth(convexAdminToken());

  return client;
}
