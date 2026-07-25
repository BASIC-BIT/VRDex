import {
  oauthMcpResourceUri,
  oauthSupportedResources,
} from "./oauth-jwt";

type OAuthResourceInput = Pick<FormData, "getAll"> | Pick<URLSearchParams, "getAll">;

function mcpAuthenticationBootstrapAlias(value: string, mcpResource: string) {
  try {
    const candidate = new URL(value);
    const canonical = new URL(mcpResource);

    return candidate.origin === canonical.origin
      && candidate.pathname === canonical.pathname
      && candidate.username === ""
      && candidate.password === ""
      && candidate.hash === ""
      && candidate.searchParams.size === 1
      && candidate.searchParams.get("auth") === "required";
  } catch {
    return false;
  }
}

export function normalizedOAuthResourceIndicator(
  request: Request,
  input: OAuthResourceInput,
) {
  const resources = [
    ...new Set(
      input.getAll("resource")
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ];

  if (resources.length === 0) {
    return undefined;
  }

  const supportedResources = oauthSupportedResources(request);

  if (resources.length === 1 && supportedResources.includes(resources[0])) {
    return resources[0];
  }

  const mcpResource = oauthMcpResourceUri(request);

  if (
    resources.includes(mcpResource)
    && resources.every(
      (resource) => resource === mcpResource || mcpAuthenticationBootstrapAlias(resource, mcpResource),
    )
  ) {
    return mcpResource;
  }

  throw new Error("The requested OAuth resource is not supported by this deployment.");
}
