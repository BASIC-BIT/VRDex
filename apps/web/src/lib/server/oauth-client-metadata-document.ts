import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import {
  normalizeDynamicMcpClientRegistration,
  normalizeOAuthClientMetadataDocumentUrl,
  type DynamicMcpClientRegistration,
} from "@vrdex/api-contracts";

const maxClientMetadataDocumentBytes = 5 * 1024;

type HostAddress = {
  address: string;
};

type FetchOAuthClientMetadataDocumentOptions = {
  fetcher?: typeof fetch;
  resolveHostname?: (hostname: string) => Promise<HostAddress[]>;
};

export type OAuthClientMetadataDocument = DynamicMcpClientRegistration & {
  clientId: string;
};

function ipv4ToInt(address: string) {
  const parts = address.split(".").map((part) => Number(part));

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return parts.reduce((value, part) => ((value << 8) | part) >>> 0, 0);
}

function ipv4InCidr(address: string, cidr: string) {
  const [rangeAddress, prefixText] = cidr.split("/");
  const range = ipv4ToInt(rangeAddress);
  const value = ipv4ToInt(address);
  const prefix = Number(prefixText);

  if (range === null || value === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

  return (value & mask) === (range & mask);
}

function isSpecialUseIpv4(address: string) {
  return [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.0.0.0/24",
    "192.0.2.0/24",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "198.51.100.0/24",
    "203.0.113.0/24",
    "224.0.0.0/4",
    "240.0.0.0/4",
  ].some((cidr) => ipv4InCidr(address, cidr));
}

function isSpecialUseIpv6(address: string) {
  const normalized = address.toLowerCase();

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff")
  );
}

function isSpecialUseAddress(address: string) {
  const version = isIP(address);

  if (version === 4) {
    return isSpecialUseIpv4(address);
  }

  if (version === 6) {
    if (address.toLowerCase().startsWith("::ffff:")) {
      return isSpecialUseIpv4(address.slice("::ffff:".length));
    }

    return isSpecialUseIpv6(address);
  }

  return true;
}

async function defaultResolveHostname(hostname: string) {
  return await lookup(hostname, { all: true, verbatim: true });
}

async function assertPublicHostname(hostname: string, resolveHostname: (hostname: string) => Promise<HostAddress[]>) {
  const addresses = await resolveHostname(hostname);

  if (addresses.length === 0) {
    throw new Error("OAuth client metadata document hostname did not resolve.");
  }

  for (const address of addresses) {
    if (isSpecialUseAddress(address.address)) {
      throw new Error("OAuth client metadata document URL must resolve to a public address.");
    }
  }
}

async function responseTextWithLimit(response: Response) {
  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;

    if (totalBytes > maxClientMetadataDocumentBytes) {
      throw new Error("OAuth client metadata document is too large.");
    }

    chunks.push(value);
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
  const normalizedClientId = normalizeOAuthClientMetadataDocumentUrl(clientId);
  const clientIdUrl = new URL(normalizedClientId);
  const fetcher = options.fetcher ?? fetch;
  const resolveHostname = options.resolveHostname ?? defaultResolveHostname;

  await assertPublicHostname(clientIdUrl.hostname, resolveHostname);

  const response = await fetcher(normalizedClientId, {
    cache: "no-store",
    headers: {
      accept: "application/json",
    },
    redirect: "manual",
  });

  if (response.status !== 200) {
    throw new Error("OAuth client metadata document must return HTTP 200.");
  }

  const payload = objectPayload(JSON.parse(await responseTextWithLimit(response)));

  if (payload.client_id !== normalizedClientId) {
    throw new Error("OAuth client metadata document client_id must match the document URL.");
  }

  return {
    clientId: normalizedClientId,
    ...normalizeDynamicMcpClientRegistration(payload),
  };
}
