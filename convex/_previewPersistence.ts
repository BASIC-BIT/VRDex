import { timingSafeEqualString } from "./_apiTokens";

type PreviewPersistenceEnvironment = Record<string, string | undefined>;

export function requirePreviewPersistenceBridge(
  suppliedSecret: string,
  environment: PreviewPersistenceEnvironment = process.env,
) {
  const expectedSecret = environment.VRDEX_PREVIEW_PERSISTENCE_SECRET?.trim();

  if (
    environment.VRDEX_DEPLOYMENT_ENV !== "preview" ||
    environment.VRDEX_ENABLE_PREVIEW_PERSISTENCE_BRIDGE !== "true" ||
    !expectedSecret ||
    !timingSafeEqualString(suppliedSecret, expectedSecret)
  ) {
    throw new Error("Preview OAuth persistence bridge is unavailable.");
  }
}

export function requireHostedSmokeFixture(
  environment: PreviewPersistenceEnvironment = process.env,
) {
  const deploymentEnvironment = environment.VRDEX_DEPLOYMENT_ENV;

  if (
    (deploymentEnvironment !== "preview" && deploymentEnvironment !== "staging") ||
    environment.VRDEX_ENABLE_HOSTED_SMOKE_FIXTURE !== "true"
  ) {
    throw new Error("Hosted smoke fixtures are unavailable for this deployment.");
  }
}
