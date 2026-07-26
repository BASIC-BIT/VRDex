import { createHash } from "node:crypto";

import sharp from "sharp";

export const PROFILE_ASSET_MAX_SOURCE_DIMENSION = 8_192;
export const PROFILE_ASSET_MAX_STORED_DIMENSION = 4_096;

export function profileAssetMimeTypeForFile(fileType: string, fileName: string): string {
  const contentType = fileType.split(";")[0]!.trim().toLowerCase();

  if (contentType && contentType !== "application/octet-stream") {
    return contentType;
  }

  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".svg")) return "image/svg+xml";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "image/jpeg";
  if (lowerName.endsWith(".webp")) return "image/webp";
  if (lowerName.endsWith(".png")) return "image/png";
  return contentType;
}

type SafeProfileAsset = {
  body: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
  width: number;
  height: number;
  contentSha256: string;
};

function detectedRasterMimeType(body: Uint8Array): SafeProfileAsset["mimeType"] | null {
  if (
    body.length >= 8 &&
    body[0] === 0x89 &&
    body[1] === 0x50 &&
    body[2] === 0x4e &&
    body[3] === 0x47 &&
    body[4] === 0x0d &&
    body[5] === 0x0a &&
    body[6] === 0x1a &&
    body[7] === 0x0a
  ) {
    return "image/png";
  }

  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    body.length >= 12 &&
    new TextDecoder("ascii").decode(body.slice(0, 4)) === "RIFF" &&
    new TextDecoder("ascii").decode(body.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

function svgDimensions(source: string): { width: number; height: number } {
  const svgTag = source.match(/<svg\b[^>]*>/i)?.[0];
  if (!svgTag) {
    throw new Error("SVG uploads must contain an SVG root element.");
  }

  const numberAttribute = (name: string) => {
    const match = svgTag.match(new RegExp(`\\b${name}\\s*=\\s*["']\\s*([0-9]+(?:\\.[0-9]+)?)`, "i"));
    return match?.[1] ? Number(match[1]) : undefined;
  };
  let width = numberAttribute("width");
  let height = numberAttribute("height");
  const viewBox = svgTag.match(/\bviewBox\s*=\s*["']\s*[-+0-9.e]+\s+[-+0-9.e]+\s+([-+0-9.e]+)\s+([-+0-9.e]+)/i);

  if ((width === undefined || height === undefined) && viewBox?.[1] && viewBox[2]) {
    width ??= Number(viewBox[1]);
    height ??= Number(viewBox[2]);
  }

  if (!Number.isFinite(width) || !Number.isFinite(height) || width! <= 0 || height! <= 0) {
    throw new Error("SVG uploads must include positive width and height or a valid viewBox.");
  }

  return { width: Math.round(width!), height: Math.round(height!) };
}

function validateSafeSvg(body: Uint8Array): { body: Uint8Array; width: number; height: number } {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(body).replace(/^\uFEFF/, "").trim();
  const blockedMarkup = /<!doctype|<!entity|<(?:(?:[a-z_][\w.-]*):)?(?:script|style|foreignobject|iframe|object|embed|audio|video|image|animate(?:color|motion|transform)?|discard|mpath|set)\b/i;
  const namespacePrefix = /(?:<|\s)[a-z_][\w.-]*:[a-z_][\w.-]*(?:\s|=|\/?>)/i;
  const processingInstruction = /<\?(?!xml\b)/i;
  const activeAttribute = /\son[a-z0-9_-]+\s*=/i;
  const externalReference = /\b(?:href|src)\s*=\s*["']\s*(?!#)[^"']+/i;
  const externalCssUrl = [...source.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)]
    .some((match) => !match[1]?.startsWith("#"));

  if (
    blockedMarkup.test(source) ||
    namespacePrefix.test(source) ||
    processingInstruction.test(source) ||
    activeAttribute.test(source) ||
    externalReference.test(source) ||
    externalCssUrl
  ) {
    throw new Error("SVG uploads cannot contain scripts, embedded media, event handlers, or external references.");
  }

  const dimensions = svgDimensions(source);
  return { body: new TextEncoder().encode(source), ...dimensions };
}

function assertSourceDimensions(width: number, height: number) {
  if (width > PROFILE_ASSET_MAX_SOURCE_DIMENSION || height > PROFILE_ASSET_MAX_SOURCE_DIMENSION) {
    throw new Error(`Images must be ${PROFILE_ASSET_MAX_SOURCE_DIMENSION} pixels or smaller on each side.`);
  }
}

async function normalizeRaster(body: Uint8Array, mimeType: SafeProfileAsset["mimeType"]) {
  const pipeline = sharp(body, {
    animated: false,
    failOn: "warning",
    limitInputPixels: PROFILE_ASSET_MAX_SOURCE_DIMENSION ** 2,
  });
  const metadata = await pipeline.metadata();

  if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
    throw new Error("Profile media must be one valid, still image.");
  }
  assertSourceDimensions(metadata.width, metadata.height);

  const normalized = pipeline
    .rotate()
    .resize({
      width: PROFILE_ASSET_MAX_STORED_DIMENSION,
      height: PROFILE_ASSET_MAX_STORED_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    });
  const encoded =
    mimeType === "image/png"
      ? normalized.png({ compressionLevel: 9 })
      : mimeType === "image/webp"
        ? normalized.webp({ quality: 88 })
        : normalized.jpeg({ quality: 90, mozjpeg: true });
  const output = await encoded.toBuffer({ resolveWithObject: true });

  return {
    body: new Uint8Array(output.data),
    width: output.info.width,
    height: output.info.height,
  };
}

export async function validateAndNormalizeProfileAsset(
  body: Uint8Array,
  declaredMimeType: string,
): Promise<SafeProfileAsset> {
  const rasterMimeType = detectedRasterMimeType(body);
  const trimmedStart = new TextDecoder("utf-8").decode(body.slice(0, Math.min(body.length, 256))).replace(/^\uFEFF/, "").trimStart();
  const detectedMimeType = rasterMimeType ?? (/^(?:<\?xml\b[\s\S]*?\?>\s*)?<svg\b/i.test(trimmedStart) ? "image/svg+xml" : null);

  if (detectedMimeType === null) {
    throw new Error("The file contents are not a supported PNG, JPEG, WebP, or SVG image.");
  }
  if (detectedMimeType !== declaredMimeType) {
    throw new Error("The file contents do not match the selected image type.");
  }

  const normalized =
    detectedMimeType === "image/svg+xml"
      ? validateSafeSvg(body)
      : await normalizeRaster(body, detectedMimeType);
  assertSourceDimensions(normalized.width, normalized.height);
  const contentSha256 = createHash("sha256").update(normalized.body).digest("hex");

  return {
    ...normalized,
    mimeType: detectedMimeType,
    contentSha256,
  };
}
