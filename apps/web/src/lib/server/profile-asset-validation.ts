import { createHash } from "node:crypto";

import { XMLValidator } from "fast-xml-parser";
import sharp from "sharp";

import { PROFILE_ASSET_MAX_STORED_BYTES } from "../profile-asset-limits";

export { PROFILE_ASSET_MAX_STORED_BYTES } from "../profile-asset-limits";

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

export type PreparedProfileAsset = {
  source: {
    body: Uint8Array;
    mimeType: SafeProfileAsset["mimeType"];
    contentSha256: string;
  };
  download: SafeProfileAsset;
  display: SafeProfileAsset;
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

function svgRootOffset(source: string): number | null {
  let offset = 0;
  const skipWhitespace = () => {
    while (offset < source.length && /\s/u.test(source[offset]!)) {
      offset += 1;
    }
  };

  skipWhitespace();
  if (source.slice(offset, offset + 5).toLowerCase() === "<?xml") {
    const declarationEnd = source.indexOf("?>", offset + 5);
    if (declarationEnd === -1) return null;
    offset = declarationEnd + 2;
    skipWhitespace();
  }
  while (source.startsWith("<!--", offset)) {
    const commentEnd = source.indexOf("-->", offset + 4);
    if (commentEnd === -1) return null;
    offset = commentEnd + 3;
    skipWhitespace();
  }

  return /^<svg\b/i.test(source.slice(offset)) ? offset : null;
}

function hasSvgRoot(body: Uint8Array): boolean {
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(body).replace(/^\uFEFF/, "");
    return svgRootOffset(source) !== null;
  } catch {
    return false;
  }
}

function svgDimensions(source: string): { width: number; height: number } {
  const rootOffset = svgRootOffset(source);
  if (rootOffset === null) {
    throw new Error("SVG uploads must contain an SVG root element.");
  }
  let quote: '"' | "'" | null = null;
  let tagEnd = -1;
  for (let index = rootOffset + 4; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      tagEnd = index;
      break;
    }
  }
  if (tagEnd === -1 || quote) {
    throw new Error("SVG uploads must contain an SVG root element.");
  }
  const svgTag = source.slice(rootOffset, tagEnd + 1);

  const invalidDimensions = () => {
    throw new Error("SVG uploads must include positive width and height or a valid viewBox.");
  };
  const attributes = new Map<string, string>();
  let offset = 4;
  while (offset < svgTag.length - 1) {
    while (/\s/u.test(svgTag[offset]!)) offset += 1;
    if (svgTag[offset] === "/" || svgTag[offset] === ">") break;

    const nameStart = offset;
    if (!/[a-z_:]/iu.test(svgTag[offset]!)) invalidDimensions();
    offset += 1;
    while (/[a-z0-9_.:-]/iu.test(svgTag[offset] ?? "")) offset += 1;
    const name = svgTag.slice(nameStart, offset).toLowerCase();
    while (/\s/u.test(svgTag[offset]!)) offset += 1;
    if (svgTag[offset] !== "=") invalidDimensions();
    offset += 1;
    while (/\s/u.test(svgTag[offset]!)) offset += 1;

    const quote = svgTag[offset];
    if (quote !== '"' && quote !== "'") invalidDimensions();
    const valueStart = ++offset;
    const valueEnd = svgTag.indexOf(quote, valueStart);
    if (valueEnd === -1 || attributes.has(name)) invalidDimensions();
    attributes.set(name, svgTag.slice(valueStart, valueEnd));
    offset = valueEnd + 1;
  }

  const attributeValue = (name: string) => attributes.get(name.toLowerCase())?.trim();
  const numberAttribute = (name: string) => {
    const value = attributeValue(name);
    if (!value) return undefined;
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value)) {
      invalidDimensions();
    }
    return Number(value);
  };
  let width = numberAttribute("width");
  let height = numberAttribute("height");

  if (width === undefined || height === undefined) {
    const viewBox = attributeValue("viewBox")?.split(/(?:\s*,\s*|\s+)/u);
    const svgNumber = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu;
    if (viewBox?.length !== 4 || viewBox.some((value) => !svgNumber.test(value))) {
      invalidDimensions();
    }
    width ??= Number(viewBox![2]);
    height ??= Number(viewBox![3]);
  }

  if (!Number.isFinite(width) || !Number.isFinite(height) || width! <= 0 || height! <= 0) {
    invalidDimensions();
  }

  return { width: Math.round(width!), height: Math.round(height!) };
}

function validateSafeSvg(body: Uint8Array): { body: Uint8Array; width: number; height: number } {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(body).replace(/^\uFEFF/, "").trim();
  if (XMLValidator.validate(source) !== true) {
    throw new Error("Profile media must be one valid, still image.");
  }
  const blockedMarkup = /<!doctype|<!entity|<(?:(?:[a-z_][\w.-]*):)?(?:script|style|foreignobject|iframe|object|embed|audio|video|image|animate(?:color|motion|transform)?|discard|mpath|set)\b/i;
  const namespaceSyntax = /<\s*\/?\s*[^\s/>:]+:|\s[^\s=/>:]+:[^\s=/>]+\s*=/u;
  const processingInstruction = /<\?(?!xml\b)/i;
  const activeAttribute = /\son[a-z0-9_-]+\s*=/i;
  const styleAttribute = /\sstyle\s*=/i;
  const cssEscape = /\\/u;
  const numericCharacterReference = /&#(?:x[0-9a-f]+|\d+);/iu;
  const externalReference = /\b(?:href|src)\s*=\s*["']\s*(?!#)[^"']+/i;
  const externalCssUrl = [...source.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)]
    .some((match) => !match[1]?.startsWith("#"));

  if (
    blockedMarkup.test(source) ||
    namespaceSyntax.test(source) ||
    processingInstruction.test(source) ||
    activeAttribute.test(source) ||
    styleAttribute.test(source) ||
    cssEscape.test(source) ||
    numericCharacterReference.test(source) ||
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

function rasterPipeline(body: Uint8Array) {
  return sharp(body, {
    animated: false,
    failOn: "warning",
    limitInputPixels: PROFILE_ASSET_MAX_SOURCE_DIMENSION ** 2,
  });
}

async function encodeInOriginalRasterFormat(
  body: Uint8Array,
  mimeType: SafeProfileAsset["mimeType"],
) {
  if (mimeType === "image/png") {
    let candidate = await rasterPipeline(body)
      .rotate()
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    if (candidate.data.byteLength <= PROFILE_ASSET_MAX_STORED_BYTES) {
      return candidate;
    }

    for (const quality of [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 1]) {
      candidate = await rasterPipeline(body)
        .rotate()
        .png({
          compressionLevel: 9,
          palette: true,
          colours: 256,
          quality,
          effort: 10,
        })
        .toBuffer({ resolveWithObject: true });
      if (candidate.data.byteLength <= PROFILE_ASSET_MAX_STORED_BYTES) {
        return candidate;
      }
    }

    throw new Error("Profile media assets must be 12 MB or smaller.");
  }

  const qualities = mimeType === "image/webp"
    ? [90, 80, 70, 60, 50, 40, 30, 20, 10, 5, 1]
    : [95, 90, 85, 80, 70, 60, 50, 40, 30, 20, 10, 5, 1];
  let candidate:
    | Awaited<ReturnType<ReturnType<typeof rasterPipeline>["toBuffer"]>>
    | undefined;

  for (const quality of qualities) {
    candidate = mimeType === "image/webp"
      ? await rasterPipeline(body)
        .rotate()
        .webp({ quality, alphaQuality: 100, effort: 6, smartSubsample: true })
        .toBuffer({ resolveWithObject: true })
      : await rasterPipeline(body)
        .rotate()
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
    if (candidate.data.byteLength <= PROFILE_ASSET_MAX_STORED_BYTES) {
      return candidate;
    }
  }

  throw new Error("Profile media assets must be 12 MB or smaller.");
}

async function encodeDisplayRaster(body: Uint8Array) {
  for (const quality of [88, 70, 50, 30, 10, 1]) {
    const candidate = await rasterPipeline(body)
      .rotate()
      .resize({
        width: PROFILE_ASSET_MAX_STORED_DIMENSION,
        height: PROFILE_ASSET_MAX_STORED_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({
        quality,
        alphaQuality: quality,
        effort: 4,
        smartSubsample: true,
      })
      .toBuffer({ resolveWithObject: true });
    if (candidate.data.byteLength <= PROFILE_ASSET_MAX_STORED_BYTES) {
      return candidate;
    }
  }

  throw new Error("Profile media assets must be 12 MB or smaller.");
}

async function prepareRaster(body: Uint8Array, mimeType: SafeProfileAsset["mimeType"]) {
  const pipeline = rasterPipeline(body);
  const metadata = await pipeline.metadata();

  if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
    throw new Error("Profile media must be one valid, still image.");
  }
  assertSourceDimensions(metadata.width, metadata.height);

  const sanitized = await encodeInOriginalRasterFormat(body, mimeType);
  const display = await encodeDisplayRaster(body);

  return {
    download: {
      body: new Uint8Array(sanitized.data),
      width: sanitized.info.width,
      height: sanitized.info.height,
    },
    display: {
      body: new Uint8Array(display.data),
      width: display.info.width,
      height: display.info.height,
    },
  };
}

export async function validateAndPrepareProfileAsset(
  body: Uint8Array,
  declaredMimeType: string,
): Promise<PreparedProfileAsset> {
  const rasterMimeType = detectedRasterMimeType(body);
  const detectedMimeType = rasterMimeType ?? (hasSvgRoot(body) ? "image/svg+xml" : null);

  if (detectedMimeType === null) {
    throw new Error("The file contents are not a supported PNG, JPEG, WebP, or SVG image.");
  }
  if (detectedMimeType !== declaredMimeType) {
    throw new Error("The file contents do not match the selected image type.");
  }

  const sourceContentSha256 = createHash("sha256").update(body).digest("hex");

  if (detectedMimeType === "image/svg+xml") {
    const sanitized = validateSafeSvg(body);
    assertSourceDimensions(sanitized.width, sanitized.height);
    const contentSha256 = createHash("sha256").update(sanitized.body).digest("hex");
    const safeSvg = {
      ...sanitized,
      mimeType: detectedMimeType,
      contentSha256,
    } satisfies SafeProfileAsset;
    return {
      source: { body, mimeType: detectedMimeType, contentSha256: sourceContentSha256 },
      download: safeSvg,
      display: safeSvg,
    };
  }

  const prepared = await prepareRaster(body, detectedMimeType);
  const download: SafeProfileAsset = {
    ...prepared.download,
    mimeType: detectedMimeType,
    contentSha256: createHash("sha256").update(prepared.download.body).digest("hex"),
  };
  const display: SafeProfileAsset = {
    ...prepared.display,
    mimeType: "image/webp",
    contentSha256: createHash("sha256").update(prepared.display.body).digest("hex"),
  };
  return {
    source: { body, mimeType: detectedMimeType, contentSha256: sourceContentSha256 },
    download,
    display,
  };
}

export async function validateAndNormalizeProfileAsset(
  body: Uint8Array,
  declaredMimeType: string,
): Promise<SafeProfileAsset> {
  return (await validateAndPrepareProfileAsset(body, declaredMimeType)).display;
}
