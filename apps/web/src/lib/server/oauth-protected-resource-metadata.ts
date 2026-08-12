import { oauthApiScopes } from "@vrdex/api-contracts";

import { oauthApiResourceUri, oauthIssuerUrl, oauthMcpResourceUri } from "./oauth-jwt";
import { hostedMcpScopesAllowedForDynamicClient } from "./hosted-mcp-policy";

const apiResourceScopes = oauthApiScopes.filter((scope) => scope !== "mcp:read" && scope !== "mcp:write");

function protectedResourceMetadata(
  request: Request,
  options: {
    name: string;
    resource: string;
    scopes: readonly string[];
  },
) {
  const issuer = oauthIssuerUrl(request);

  return {
    resource: options.resource,
    authorization_servers: [issuer],
    scopes_supported: options.scopes,
    bearer_methods_supported: ["header"],
    resource_name: options.name,
    resource_documentation: `${issuer}/developers/api`,
  };
}

export function apiProtectedResourceMetadata(request: Request) {
  return protectedResourceMetadata(request, {
    name: "VRDex API",
    resource: oauthApiResourceUri(request),
    scopes: apiResourceScopes,
  });
}

export function mcpProtectedResourceMetadata(request: Request) {
  return protectedResourceMetadata(request, {
    name: "VRDex MCP",
    resource: oauthMcpResourceUri(request),
    scopes: hostedMcpScopesAllowedForDynamicClient(),
  });
}
