import { dynamicMcpWriteScopes, type ApiScope } from "@vrdex/api-contracts";

export const hostedMcpReadScopes = ["mcp:read"] as const satisfies readonly ApiScope[];
/**
 * Every write scope a hosted MCP session can hold.
 *
 * There is deliberately no deployment switch in front of this. A gate here
 * decided for every client what its operator was better placed to decide: the
 * tools are advertised, and the harness connecting picks which of them it will
 * expose or call. Self-hosters who want a read-only deployment still have
 * `VRDEX_HOSTED_MCP_ANONYMOUS_READS`, and every write remains bounded by the
 * scopes the user actually granted plus the per-profile permission checks the
 * browser path enforces.
 */
export const hostedMcpWriteScopes = dynamicMcpWriteScopes;
/**
 * Read scopes a hosted session may hold beyond the transport one.
 *
 * Deliberately not folded into `hostedMcpReadScopes`, which is the pair every
 * public read tool advertises: adding it there would tell an anonymous caller
 * that reading a public profile needs `profile:read`. This is the discovery
 * catalog, so a client deriving its registration from protected-resource
 * metadata can ask for the owned-inventory tool instead of finding out after
 * registering that it cannot call it.
 */
export const hostedMcpOwnedReadScopes = [
  "profile:read",
  "assets:contribute",
] as const satisfies readonly ApiScope[];

export function hostedMcpScopesAllowedForDynamicClient() {
  return [...new Set([
    ...hostedMcpReadScopes,
    ...hostedMcpOwnedReadScopes,
    ...hostedMcpWriteScopes,
  ])];
}
