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

export function hostedMcpScopesAllowedForDynamicClient() {
  return [...hostedMcpReadScopes, ...hostedMcpWriteScopes];
}
