import type { lookup } from "node:dns/promises";
import type { request } from "node:https";
export type RelaySource = {
  id: string;
  revision?: string | number;
  type: string;
  publicUrl: string;
};
export type RelayInput = {
  transportReady: Promise<{ url: string }>;
  dispose(): Promise<void>;
};
export type SourceRelay = {
  createInput(args: { source: RelaySource; signal?: AbortSignal }): RelayInput;
  resolveSource(source: RelaySource): string;
  retainSources(sources: RelaySource[]): void;
  stop(): void;
};
export function isPublicIPv4(address: string): boolean;
export function validateSourceEndpoint(
  value: string,
  operatorEndpoints?: string[],
  inputFormat?: "mpegts" | "vrcdn_fmp4",
): URL;
export function createSourceRelay(options?: {
  operatorEndpoints?: string[];
  inputFormat?: "mpegts" | "vrcdn_fmp4";
  resolveAddresses?: typeof lookup;
  createResolver?: () => {
    resolve4(hostname: string): Promise<string[]>;
    cancel(): void;
  };
  requestSource?: typeof request;
}): Promise<SourceRelay>;
