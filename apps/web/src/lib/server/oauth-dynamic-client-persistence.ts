export type DynamicMcpClientMutationInput = {
  allowedScopes: Array<
    | "public:read"
    | "profile:read"
    | "profile:write"
    | "community:read"
    | "community:write"
    | "events:read"
    | "events:write"
    | "assets:read"
    | "assets:write"
    | "developer:read"
    | "developer:write"
    | "mcp:read"
    | "mcp:write"
  >;
  clientId: string;
  clientName: string;
  clientUri?: string;
  contacts: string[];
  grantTypes: Array<"authorization_code" | "refresh_token" | "client_credentials">;
  logoUri?: string;
  redirectUris: string[];
  resource: string;
  responseTypes: "code"[];
  softwareId?: string;
  softwareVersion?: string;
  tokenEndpointAuthMethod: "none";
};

type PreviewPersistenceEnvironment = Record<string, string | undefined>;

export function previewPersistenceBridgeSecret(
  environment: PreviewPersistenceEnvironment = process.env,
) {
  if (environment.VRDEX_ENABLE_PREVIEW_PERSISTENCE_BRIDGE !== "true") {
    return undefined;
  }

  const secret = environment.VRDEX_PREVIEW_PERSISTENCE_SECRET?.trim();

  if (environment.VRDEX_DEPLOYMENT_ENV !== "preview" || !secret) {
    throw new Error("Preview OAuth persistence bridge configuration is incomplete.");
  }

  return secret;
}

export async function createDynamicMcpClient(input: DynamicMcpClientMutationInput) {
  const bridgeSecret = previewPersistenceBridgeSecret();
  const [{ api, internal }, { convexAdminHttpClient, convexHttpClient }] = await Promise.all([
    import("@convex-generated-api"),
    import("./convex-http"),
  ]);

  if (bridgeSecret !== undefined) {
    return await convexHttpClient().mutation(api.oauthApps.createPreviewDynamicMcpClient, {
      ...input,
      bridgeSecret,
    });
  }

  return await convexAdminHttpClient().mutation(internal.oauthApps.createDynamicMcpClient, input);
}

export async function upsertClientMetadataDocumentMcpClient(input: DynamicMcpClientMutationInput) {
  const bridgeSecret = previewPersistenceBridgeSecret();
  const [{ api, internal }, { convexAdminHttpClient, convexHttpClient }] = await Promise.all([
    import("@convex-generated-api"),
    import("./convex-http"),
  ]);

  if (bridgeSecret !== undefined) {
    return await convexHttpClient().mutation(api.oauthApps.upsertPreviewClientMetadataDocumentMcpClient, {
      ...input,
      bridgeSecret,
    });
  }

  return await convexAdminHttpClient().mutation(
    internal.oauthApps.upsertClientMetadataDocumentMcpClient,
    input,
  );
}
