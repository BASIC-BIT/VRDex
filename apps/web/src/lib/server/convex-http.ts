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
  action<Action extends FunctionReference<"action", "public" | "internal">>(
    action: Action,
    ...args: OptionalRestArgs<Action>
  ): Promise<FunctionReturnType<Action>>;
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

/**
 * The admin client, or null where no server credential is configured.
 *
 * `convexAdminHttpClient` throws on construction, which is right for a caller
 * that cannot proceed without it — but wrong for a fallback: the throw escapes
 * before any `.catch()` attached to the call, so a deployment missing the
 * credential lost the cleanup entirely instead of degrading. Callers that have
 * something else to try should ask for it this way.
 */
export function optionalConvexAdminHttpClient() {
  try {
    return convexAdminHttpClient();
  } catch {
    return null;
  }
}

export function convexAdminHttpClient() {
  const client = convexHttpClient() as ConvexHttpClientWithAdminAuth;

  client.setAdminAuth(convexAdminToken());

  return client;
}
