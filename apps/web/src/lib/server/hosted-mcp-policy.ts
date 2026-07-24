import type { ApiScope } from "@vrdex/api-contracts";

export const hostedMcpReadScopes = ["mcp:read"] as const satisfies readonly ApiScope[];
export const hostedMcpEventWriteScopes = ["mcp:write", "events:write"] as const satisfies readonly ApiScope[];

export function hostedMcpEventWritesEnabled(
  value = process.env.VRDEX_HOSTED_MCP_EVENT_WRITES,
) {
  const normalized = value?.trim().toLowerCase();

  if (normalized === undefined || normalized === "" || normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }

  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }

  throw new Error("VRDEX_HOSTED_MCP_EVENT_WRITES must be true or false when set.");
}

export function hostedMcpScopesAllowedForDynamicClient() {
  return hostedMcpEventWritesEnabled()
    ? [...hostedMcpReadScopes, ...hostedMcpEventWriteScopes]
    : [...hostedMcpReadScopes];
}

export function requestUsesHostedMcpEventWriteScopes(scopes: readonly string[]) {
  return hostedMcpEventWriteScopes.some((scope) => scopes.includes(scope));
}

export function hostedMcpEventWriteGrantAllowed(args: {
  eventWritesEnabled?: boolean;
  mcpResource: string;
  requestedScopes: readonly string[];
  resource: string;
}) {
  return args.resource !== args.mcpResource
    || !requestUsesHostedMcpEventWriteScopes(args.requestedScopes)
    || (args.eventWritesEnabled ?? hostedMcpEventWritesEnabled());
}
