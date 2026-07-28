import { createHash } from "node:crypto";

import sharp from "sharp";

const DEFAULT_MODEL = "gpt-5.6-luna";
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_DESCRIPTION_LENGTH = 140;
const MAX_REQUEST_BYTES = 2_100_000;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

type AccessibilityImage = {
  dataUrl: string;
  byteSize: number;
  mimeType: "image/webp";
};

type AccessibilityImageEnvelope = {
  base64: string;
  byteSize: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
};

export class ProfileAssetAccessibilityProviderError extends Error {
  constructor(
    readonly code: "configuration" | "invalid_image" | "provider" | "timeout" | "invalid_response",
    message: string,
  ) {
    super(message);
  }
}

export function profileAssetAccessibilityModel() {
  return process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_MODEL?.trim() || DEFAULT_MODEL;
}

export function isProfileAssetAccessibilityGenerationConfigured() {
  return (
    process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_GENERATION_ENABLED === "true" &&
    Boolean(process.env.OPENAI_API_KEY?.trim())
  );
}

export function profileAssetAccessibilityErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (error instanceof ProfileAssetAccessibilityProviderError && error.code === "invalid_image") {
    return message.includes("too large") ? 413 : 400;
  }
  if (message.includes("request metadata is invalid")) return 400;
  if (message.includes("permission") || message.includes("owner")) return 403;
  if (message.includes("limit") || message.includes("Wait a moment")) return 429;
  return 502;
}

export async function readProfileAssetAccessibilityRequest(
  request: Request,
): Promise<{ imageDataUrl?: unknown; requestId?: unknown }> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new ProfileAssetAccessibilityProviderError("invalid_image", "Image preview is invalid.");
    }
    if (contentLength > MAX_REQUEST_BYTES) {
      throw new ProfileAssetAccessibilityProviderError("invalid_image", "Image preview is too large.");
    }
  }
  if (request.body === null) {
    throw new ProfileAssetAccessibilityProviderError("invalid_image", "Image preview is invalid.");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new ProfileAssetAccessibilityProviderError("invalid_image", "Image preview is too large.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as {
      imageDataUrl?: unknown;
      requestId?: unknown;
    };
  } catch {
    throw new ProfileAssetAccessibilityProviderError("invalid_image", "Image preview is invalid.");
  }
}

export function inspectAccessibilityImageDataUrl(value: unknown): AccessibilityImageEnvelope {
  if (typeof value !== "string" || value.length > MAX_REQUEST_BYTES) {
    throw new ProfileAssetAccessibilityProviderError("invalid_image", "Image preview is too large.");
  }
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/]+={0,2})$/iu.exec(value);
  if (match === null) {
    throw new ProfileAssetAccessibilityProviderError("invalid_image", "Image preview is invalid.");
  }
  const base64 = match[2]!;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const byteSize = Math.floor((base64.length * 3) / 4) - padding;
  if (byteSize <= 0 || byteSize > MAX_IMAGE_BYTES) {
    throw new ProfileAssetAccessibilityProviderError("invalid_image", "Image preview is too large.");
  }
  return {
    base64,
    byteSize,
    mimeType: match[1]!.toLowerCase() as AccessibilityImageEnvelope["mimeType"],
  };
}

export async function parseAccessibilityImageDataUrl(value: unknown): Promise<AccessibilityImage> {
  const envelope = inspectAccessibilityImageDataUrl(value);
  const bytes = Buffer.from(envelope.base64, "base64");
  if (bytes.byteLength !== envelope.byteSize) {
    throw new ProfileAssetAccessibilityProviderError("invalid_image", "Image preview is invalid.");
  }
  let sanitized: Buffer;
  try {
    const pipeline = sharp(bytes, {
      animated: false,
      failOn: "warning",
      limitInputPixels: 1_024 * 1_024,
    });
    const metadata = await pipeline.metadata();
    const expectedFormat = envelope.mimeType.replace("image/", "").replace("jpeg", "jpg");
    const detectedFormat = metadata.format?.replace("jpeg", "jpg");
    if (
      detectedFormat !== expectedFormat ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 1_024 ||
      metadata.height > 1_024 ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw new Error("invalid");
    }
    sanitized = await sharp(bytes, {
      animated: false,
      failOn: "warning",
      limitInputPixels: 1_024 * 1_024,
    })
      .rotate()
      .webp({ quality: 82, alphaQuality: 100 })
      .toBuffer();
    if (sanitized.byteLength === 0 || sanitized.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("invalid");
    }
  } catch {
    throw new ProfileAssetAccessibilityProviderError("invalid_image", "Image preview is invalid.");
  }
  return {
    dataUrl: `data:image/webp;base64,${sanitized.toString("base64")}`,
    byteSize: sanitized.byteLength,
    mimeType: "image/webp",
  };
}

function responseText(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  if ("output_text" in value && typeof value.output_text === "string") return value.output_text;
  if (!("output" in value) || !Array.isArray(value.output)) return null;
  for (const item of value.output) {
    if (typeof item !== "object" || item === null || !("content" in item) || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (
        typeof content === "object" &&
        content !== null &&
        "type" in content &&
        content.type === "output_text" &&
        "text" in content &&
        typeof content.text === "string"
      ) {
        return content.text;
      }
    }
  }
  return null;
}

export function normalizeGeneratedAccessibilityDescription(value: string) {
  const normalized = value.trim().replace(/\s+/gu, " ").replace(/^["']|["']$/gu, "");
  const firstSentence = normalized.match(/^.*?[.!?](?:\s|$)/u)?.[0]?.trim() ?? normalized;
  if (firstSentence.length <= MAX_DESCRIPTION_LENGTH) return firstSentence;
  const truncated = firstSentence.slice(0, MAX_DESCRIPTION_LENGTH - 1);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${truncated.slice(0, Math.max(1, lastSpace)).replace(/[,:;.!?]+$/u, "")}.`;
}

export async function generateProfileAssetAccessibilityDescription(
  image: AccessibilityImage,
  input: {
    userId: string;
    fetchImplementation?: typeof fetch;
  },
) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!isProfileAssetAccessibilityGenerationConfigured() || !apiKey) {
    throw new ProfileAssetAccessibilityProviderError("configuration", "Generation is not configured.");
  }
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const model = profileAssetAccessibilityModel();
  const safetyIdentifier = createHash("sha256")
    .update(`vrdex-profile-media:${input.userId}`)
    .digest("hex");
  let response: Response;
  try {
    response = await fetchImplementation(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: "none" },
        max_output_tokens: 80,
        safety_identifier: safetyIdentifier,
        store: false,
        text: { verbosity: "low" },
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Write one factual accessibility description of this image. Use one short sentence, at most 140 characters. Describe only important visible content. Do not use a preamble.",
              },
              {
                type: "input_image",
                image_url: image.dataUrl,
                detail: "low",
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ProfileAssetAccessibilityProviderError("timeout", "Generation timed out.");
    }
    throw new ProfileAssetAccessibilityProviderError("provider", "Generation provider request failed.");
  }
  if (!response.ok) {
    throw new ProfileAssetAccessibilityProviderError("provider", "Generation provider rejected the request.");
  }
  const output = normalizeGeneratedAccessibilityDescription(
    responseText(await response.json()) ?? "",
  );
  if (!output) {
    throw new ProfileAssetAccessibilityProviderError("invalid_response", "Generation returned no description.");
  }
  return { description: output, model };
}
