export { createVrdexApiClient } from "./api-client";
export type {
  VrdexApiClient,
  VrdexApiFailure,
  VrdexApiResult,
  VrdexApiSuccess,
  VrdexProfileType,
  VrdexSearchType,
} from "./api-client";
export {
  defaultVrdexApiBaseUrl,
  loadVrdexMcpConfig,
  normalizeApiBaseUrl,
} from "./config";
export type { VrdexMcpConfig, VrdexMcpEnv, VrdexMcpOutputMode } from "./config";
export { buildVrdexMcpServer } from "./server";
export type { VrdexMcpServerOptions } from "./server";
