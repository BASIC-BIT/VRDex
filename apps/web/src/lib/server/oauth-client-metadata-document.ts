import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

import {
  normalizeDynamicMcpClientRegistration,
  normalizeOAuthClientMetadataDocumentUrl,
  type DynamicMcpClientRegistration,
} from "@vrdex/api-contracts";

const maxClientMetadataDocumentBytes = 5 * 1024;
const clientMetadataDocumentDeadlineMs = 5_000;

export type HostAddress = {
  address: string;
};

interface PinnedLookupCallback {
  (error: Error | null, address: string, family: number): void;
  (error: Error | null, addresses: Array<{ address: string; family: number }>): void;
}

type FetchOAuthClientMetadataDocumentOptions = {
  deadlineMs?: number;
  requestDocument?: (url: URL, address: HostAddress, signal: AbortSignal) => Promise<Response>;
  resolveHostname?: (hostname: string) => Promise<HostAddress[]>;
};

export type OAuthClientMetadataDocument = DynamicMcpClientRegistration & {
  clientId: string;
};

const specialUseIpv4Addresses = new BlockList();
const specialUseIpv6Addresses = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.31.196.0", 24],
  ["192.52.193.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["192.175.48.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  specialUseIpv4Addresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  specialUseIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

function isSpecialUseAddress(address: string) {
  const version = isIP(address);

  if (version === 4) {
    return specialUseIpv4Addresses.check(address, "ipv4");
  }

  if (version === 6) {
    return specialUseIpv6Addresses.check(address, "ipv6");
  }

  return true;
}

async function defaultResolveHostname(hostname: string) {
  return await lookup(hostname, { all: true, verbatim: true });
}

async function resolvePublicHostname(hostname: string, resolveHostname: (hostname: string) => Promise<HostAddress[]>) {
  const addresses = await resolveHostname(hostname);

  if (addresses.length === 0) {
    throw new Error("OAuth client metadata document hostname did not resolve.");
  }

  for (const address of addresses) {
    if (isSpecialUseAddress(address.address)) {
      throw new Error("OAuth client metadata document URL must resolve to a public address.");
    }
  }

  return addresses;
}

export function pinnedLookupForAddress(address: HostAddress) {
  const family = isIP(address.address);

  if (family !== 4 && family !== 6) {
    throw new Error("OAuth client metadata document hostname returned an invalid address.");
  }

  return (_hostname: string, options: number | { all?: boolean }, callback: PinnedLookupCallback) => {
    if (typeof options === "object" && options.all === true) {
      callback(null, [{ address: address.address, family }]);
      return;
    }

    callback(null, address.address, family);
  };
}

function deadlineError() {
  return new Error("OAuth client metadata document request timed out.");
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : deadlineError();
}

async function requestDocumentAtAddress(url: URL, address: HostAddress, signal: AbortSignal) {
  return await new Promise<Response>((resolve, reject) => {
    let incomingResponse: Readable | undefined;
    // This remote URL is the CIMD client id. Its complete DNS set was rejected
    // unless public, and this request's lookup is pinned to the first validated
    // address while TLS still verifies the original hostname.
    const request = httpsRequest(
      url,
      {
        agent: false,
        headers: { accept: "application/json" },
        lookup: pinnedLookupForAddress(address),
        method: "GET",
        rejectUnauthorized: true,
        servername: url.hostname,
      },
      (incoming) => {
        incomingResponse = incoming;
        const headers = new Headers();

        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              headers.append(name, item);
            }
          } else if (value !== undefined) {
            headers.set(name, value);
          }
        }

        resolve(
          new Response(Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>, {
            headers,
            status: incoming.statusCode ?? 500,
            statusText: incoming.statusMessage,
          }),
        );
      },
    );

    const abortRequest = () => {
      const error = abortReason(signal);
      incomingResponse?.destroy(error);
      request.destroy(error);
      reject(error);
    };

    if (signal.aborted) {
      abortRequest();
      return;
    }

    signal.addEventListener("abort", abortRequest, { once: true });
    request.once("close", () => signal.removeEventListener("abort", abortRequest));
    request.once("error", reject);
    request.end();
  });
}

function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.reject<T>(abortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    const abortWait = () => reject(abortReason(signal));
    signal.addEventListener("abort", abortWait, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abortWait));
  });
}

function cancelResponseBody(response: Response, reason: string) {
  if (response.body === null || response.body.locked) {
    return;
  }

  void response.body.cancel(reason).catch(() => undefined);
}

async function responseTextWithLimit(response: Response, signal: AbortSignal) {
  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let completed = false;

  try {
    for (;;) {
      const { done, value } = await waitWithSignal(reader.read(), signal);

      if (done) {
        completed = true;
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maxClientMetadataDocumentBytes) {
        throw new Error("OAuth client metadata document is too large.");
      }

      chunks.push(value);
    }
  } finally {
    if (!completed) {
      void reader.cancel("OAuth client metadata document response was rejected.").catch(() => undefined);
    }

    reader.releaseLock();
  }

  const buffer = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(buffer);
}

function objectPayload(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OAuth client metadata document must be a JSON object.");
  }

  return value as Record<string, unknown>;
}

export async function fetchOAuthClientMetadataDocument(
  clientId: string,
  options: FetchOAuthClientMetadataDocumentOptions = {},
): Promise<OAuthClientMetadataDocument> {
  const deadlineController = new AbortController();
  const deadline = setTimeout(
    () => deadlineController.abort(deadlineError()),
    options.deadlineMs ?? clientMetadataDocumentDeadlineMs,
  );

  try {
    const normalizedClientId = normalizeOAuthClientMetadataDocumentUrl(clientId);
    const clientIdUrl = new URL(normalizedClientId);
    const requestDocument = options.requestDocument ?? requestDocumentAtAddress;
    const resolveHostname = options.resolveHostname ?? defaultResolveHostname;
    const addresses = await waitWithSignal(
      resolvePublicHostname(clientIdUrl.hostname, resolveHostname),
      deadlineController.signal,
    );
    const response = await waitWithSignal(
      requestDocument(clientIdUrl, addresses[0], deadlineController.signal),
      deadlineController.signal,
    );

    if (response.status !== 200) {
      cancelResponseBody(response, "OAuth client metadata document returned a rejected status.");
      throw new Error("OAuth client metadata document must return HTTP 200.");
    }

    const payload = objectPayload(JSON.parse(await responseTextWithLimit(response, deadlineController.signal)));

    if (payload.client_id !== normalizedClientId) {
      throw new Error("OAuth client metadata document client_id must match the document URL.");
    }

    return {
      clientId: normalizedClientId,
      ...normalizeDynamicMcpClientRegistration(payload),
    };
  } finally {
    clearTimeout(deadline);
  }
}
