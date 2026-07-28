import { profileMediaMimeType } from "@/lib/profile-media-kit";

const PROFILE_MEDIA_MAX_SOURCE_DIMENSION = 8_192;
const PROFILE_MEDIA_MAX_SOURCE_PIXELS = 32_000_000;
const PROFILE_MEDIA_ACCESSIBILITY_PREVIEW_DIMENSION = 512;
const PROFILE_MEDIA_BROWSER_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const PROFILE_MEDIA_MAX_STORED_DIMENSION = 4_096;
const PROFILE_MEDIA_MAX_PREPARED_PIXELS = 12_000_000;
const PROFILE_MEDIA_SCALE_STEPS = [1, 0.85, 0.7, 0.55] as const;
const PROFILE_MEDIA_WEBP_QUALITY = 0.88;

type ImageDimensions = { width: number; height: number };
export type PreparedProfileMediaUpload = {
  changed: boolean;
  file: File;
  height?: number;
  width?: number;
};

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;

  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let markerOffset = offset + 1;
    while (bytes[markerOffset] === 0xff) markerOffset += 1;
    if (markerOffset + 7 >= bytes.length) return null;
    const marker = bytes[markerOffset]!;
    if (marker === 0xd8 || marker === 0xd9) {
      offset = markerOffset + 1;
      continue;
    }
    const segmentLength = (bytes[markerOffset + 1]! << 8) | bytes[markerOffset + 2]!;
    if (segmentLength < 2 || markerOffset + segmentLength + 1 > bytes.length) return null;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: (bytes[markerOffset + 4]! << 8) | bytes[markerOffset + 5]!,
        width: (bytes[markerOffset + 6]! << 8) | bytes[markerOffset + 7]!,
      };
    }
    offset = markerOffset + segmentLength + 1;
  }

  return null;
}

function tiffOrientation(
  bytes: Uint8Array,
  payloadOffset: number,
  payloadEnd: number,
  neutralize = false,
) {
  let tiffOffset = payloadOffset;
  if (
    payloadOffset + 6 <= payloadEnd &&
    String.fromCharCode(...bytes.subarray(payloadOffset, payloadOffset + 6)) === "Exif\0\0"
  ) {
    tiffOffset += 6;
  }
  if (tiffOffset + 8 > payloadEnd) return 1;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteOrder = String.fromCharCode(bytes[tiffOffset]!, bytes[tiffOffset + 1]!);
  const littleEndian = byteOrder === "II";
  if ((!littleEndian && byteOrder !== "MM") || view.getUint16(tiffOffset + 2, littleEndian) !== 42) {
    return 1;
  }

  const ifdOffset = tiffOffset + view.getUint32(tiffOffset + 4, littleEndian);
  if (ifdOffset + 2 > payloadEnd) return 1;
  const entryCount = view.getUint16(ifdOffset, littleEndian);
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    if (entryOffset + 12 > payloadEnd) break;
    if (
      view.getUint16(entryOffset, littleEndian) === 0x0112 &&
      view.getUint16(entryOffset + 2, littleEndian) === 3 &&
      view.getUint32(entryOffset + 4, littleEndian) === 1
    ) {
      const orientation = view.getUint16(entryOffset + 8, littleEndian);
      if (orientation >= 1 && orientation <= 8) {
        if (neutralize && orientation !== 1) view.setUint16(entryOffset + 8, 1, littleEndian);
        return orientation;
      }
      return 1;
    }
  }

  return 1;
}

function jpegOrientation(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let offset = 2;

  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let markerOffset = offset + 1;
    while (bytes[markerOffset] === 0xff) markerOffset += 1;
    if (markerOffset + 2 >= bytes.length) return 1;
    const marker = bytes[markerOffset]!;
    if (marker === 0xd8 || marker === 0xd9) {
      offset = markerOffset + 1;
      continue;
    }
    const segmentLength = (bytes[markerOffset + 1]! << 8) | bytes[markerOffset + 2]!;
    const segmentEnd = markerOffset + segmentLength + 1;
    if (segmentLength < 2 || segmentEnd > bytes.length) return 1;

    const payloadOffset = markerOffset + 3;
    if (
      marker === 0xe1 &&
      segmentLength >= 16 &&
      String.fromCharCode(...bytes.subarray(payloadOffset, payloadOffset + 6)) === "Exif\0\0"
    ) {
      return tiffOrientation(bytes, payloadOffset, segmentEnd);
    }
    offset = segmentEnd;
  }

  return 1;
}

function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  const text = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WEBP") return null;
  const format = text(12, 4);

  if (format === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16),
      height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16),
    };
  }
  if (format === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    return {
      width: 1 + bytes[21]! + ((bytes[22]! & 0x3f) << 8),
      height: 1 + (bytes[22]! >> 6) + (bytes[23]! << 2) + ((bytes[24]! & 0x0f) << 10),
    };
  }
  if (
    format === "VP8 " &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
      height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff,
    };
  }

  return null;
}

function hasPngAnimation(bytes: Uint8Array) {
  let offset = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 12 <= bytes.length) {
    const chunkLength = view.getUint32(offset);
    const chunkEnd = offset + 12 + chunkLength;
    if (chunkEnd > bytes.length) return false;
    const chunkType = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (chunkType === "acTL") return true;
    if (chunkType === "IDAT" || chunkType === "IEND") return false;
    offset = chunkEnd;
  }
  return false;
}

function pngOrientation(bytes: Uint8Array) {
  let offset = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 12 <= bytes.length) {
    const chunkLength = view.getUint32(offset);
    const payloadOffset = offset + 8;
    const payloadEnd = payloadOffset + chunkLength;
    const chunkEnd = payloadEnd + 4;
    if (chunkEnd > bytes.length) return 1;
    const chunkType = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (chunkType === "eXIf") return tiffOrientation(bytes, payloadOffset, payloadEnd);
    if (chunkType === "IEND") return 1;
    offset = chunkEnd;
  }
  return 1;
}

function hasWebpAnimation(bytes: Uint8Array) {
  let offset = 12;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 8 <= bytes.length) {
    const chunkType = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const chunkLength = view.getUint32(offset + 4, true);
    if (chunkType === "ANIM" || chunkType === "ANMF") return true;
    if (chunkType === "VP8X" && chunkLength >= 1 && (bytes[offset + 8]! & 0x02) !== 0) return true;
    const chunkEnd = offset + 8 + chunkLength + (chunkLength % 2);
    if (chunkEnd > bytes.length) return false;
    offset = chunkEnd;
  }
  return false;
}

function webpOrientation(bytes: Uint8Array) {
  let offset = 12;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 8 <= bytes.length) {
    const chunkType = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const chunkLength = view.getUint32(offset + 4, true);
    const payloadOffset = offset + 8;
    const payloadEnd = payloadOffset + chunkLength;
    const chunkEnd = payloadEnd + (chunkLength % 2);
    if (chunkEnd > bytes.length) return 1;
    if (chunkType === "EXIF") return tiffOrientation(bytes, payloadOffset, payloadEnd, true);
    offset = chunkEnd;
  }
  return 1;
}

async function inspectImage(file: File): Promise<{
  animated: boolean;
  decodeSource: Blob;
  detectedMimeType: "image/jpeg" | "image/png" | "image/webp" | null;
  dimensions: ImageDimensions | null;
  manualOrientation: number;
  orientation: number;
}> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const orientation = pngOrientation(bytes);
    return {
      animated: hasPngAnimation(bytes),
      decodeSource: file,
      detectedMimeType: "image/png",
      dimensions: { width: view.getUint32(16), height: view.getUint32(20) },
      manualOrientation: 1,
      orientation,
    };
  }
  const jpeg = jpegDimensions(bytes);
  const webp = webpDimensions(bytes);
  const orientation = jpeg === null ? webpOrientation(bytes) : jpegOrientation(bytes);
  return {
    animated: webp !== null && hasWebpAnimation(bytes),
    decodeSource: webp !== null && orientation !== 1
      ? new Blob([bytes], { type: file.type })
      : file,
    detectedMimeType: jpeg !== null
      ? "image/jpeg"
      : webp !== null
        ? "image/webp"
        : null,
    dimensions: jpeg ?? webp,
    manualOrientation: webp !== null ? orientation : 1,
    orientation,
  };
}

function drawOrientedBitmap(
  context: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  orientation: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  const swapsAxes = orientation >= 5 && orientation <= 8;
  const sourceWidth = swapsAxes ? canvasHeight : canvasWidth;
  const sourceHeight = swapsAxes ? canvasWidth : canvasHeight;
  const transforms: Record<number, [number, number, number, number, number, number]> = {
    2: [-1, 0, 0, 1, sourceWidth, 0],
    3: [-1, 0, 0, -1, sourceWidth, sourceHeight],
    4: [1, 0, 0, -1, 0, sourceHeight],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, sourceHeight, 0],
    7: [0, -1, -1, 0, sourceHeight, sourceWidth],
    8: [0, -1, 1, 0, 0, sourceWidth],
  };
  context.setTransform(...(transforms[orientation] ?? [1, 0, 0, 1, 0, 0]));
  context.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight);
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("Image could not be prepared for upload."));
        return;
      }

      resolve(blob);
    }, "image/webp", quality);
  });
}

function webpFileName(fileName: string) {
  const baseName = fileName.replace(/\.[^.]+$/, "") || "image";
  return `${baseName}.webp`;
}

export async function prepareProfileMediaUpload(file: File): Promise<PreparedProfileMediaUpload> {
  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
    return { changed: false, file };
  }

  const inspected = await inspectImage(file);
  if (
    inspected.detectedMimeType === null ||
    inspected.detectedMimeType !== profileMediaMimeType(file.type, file.name)
  ) {
    throw new Error("The file contents do not match the selected image type.");
  }
  if (inspected.animated) {
    throw new Error("Profile media must be one valid, still image.");
  }
  const dimensions = inspected.dimensions;
  if (
    dimensions === null ||
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    dimensions.width > PROFILE_MEDIA_MAX_SOURCE_DIMENSION ||
    dimensions.height > PROFILE_MEDIA_MAX_SOURCE_DIMENSION ||
    dimensions.width * dimensions.height > PROFILE_MEDIA_MAX_SOURCE_PIXELS
  ) {
    throw new Error("Image dimensions are too large.");
  }
  const swapsAxes = inspected.orientation >= 5 && inspected.orientation <= 8;
  return {
    changed: false,
    file,
    width: swapsAxes ? dimensions.height : dimensions.width,
    height: swapsAxes ? dimensions.width : dimensions.height,
  };
}

export async function prepareProfileMediaMultipartFallback(
  file: File,
): Promise<PreparedProfileMediaUpload> {
  if (file.size <= PROFILE_MEDIA_BROWSER_UPLOAD_MAX_BYTES) {
    return { changed: false, file };
  }
  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
    throw new Error("SVG images must be 4 MB or smaller.");
  }

  const inspected = await inspectImage(file);
  if (
    inspected.detectedMimeType === null ||
    inspected.detectedMimeType !== profileMediaMimeType(file.type, file.name) ||
    inspected.animated ||
    inspected.dimensions === null
  ) {
    throw new Error("Image could not be prepared for upload.");
  }
  const dimensions = inspected.dimensions;
  const swapsAxes = inspected.orientation >= 5 && inspected.orientation <= 8;
  const manuallySwapsAxes = inspected.manualOrientation >= 5 && inspected.manualOrientation <= 8;
  const orientedWidth = swapsAxes ? dimensions.height : dimensions.width;
  const orientedHeight = swapsAxes ? dimensions.width : dimensions.height;
  const preparedScale = Math.min(
    1,
    PROFILE_MEDIA_MAX_STORED_DIMENSION / Math.max(orientedWidth, orientedHeight),
    Math.sqrt(PROFILE_MEDIA_MAX_PREPARED_PIXELS / (orientedWidth * orientedHeight)),
  );
  const preparedWidth = Math.max(1, Math.round(orientedWidth * preparedScale));
  const preparedHeight = Math.max(1, Math.round(orientedHeight * preparedScale));

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(inspected.decodeSource, {
      imageOrientation: inspected.manualOrientation === 1 ? "from-image" : "none",
      resizeWidth: manuallySwapsAxes ? preparedHeight : preparedWidth,
      resizeHeight: manuallySwapsAxes ? preparedWidth : preparedHeight,
      resizeQuality: "high",
    });
  } catch {
    throw new Error("Image could not be prepared for upload.");
  }

  try {
    for (const scaleStep of PROFILE_MEDIA_SCALE_STEPS) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(preparedWidth * scaleStep));
      canvas.height = Math.max(1, Math.round(preparedHeight * scaleStep));
      const context = canvas.getContext("2d");
      if (context === null) {
        throw new Error("Image could not be prepared for upload.");
      }
      if (inspected.manualOrientation === 1) {
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      } else {
        drawOrientedBitmap(
          context,
          bitmap,
          inspected.manualOrientation,
          canvas.width,
          canvas.height,
        );
      }
      const blob = await canvasToWebp(canvas, PROFILE_MEDIA_WEBP_QUALITY);
      if (blob.size <= PROFILE_MEDIA_BROWSER_UPLOAD_MAX_BYTES) {
        return {
          changed: true,
          file: new File([blob], webpFileName(file.name), {
            type: "image/webp",
            lastModified: file.lastModified,
          }),
          width: canvas.width,
          height: canvas.height,
        };
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("Image could not be prepared for upload.");
}

export async function createProfileMediaAccessibilityPreview(file: File) {
  const inspected = await inspectImage(file);
  const bitmap = await createImageBitmap(inspected.decodeSource, {
    imageOrientation: inspected.manualOrientation === 1 ? "from-image" : "none",
  });
  try {
    const orientation = inspected.manualOrientation;
    const swapsAxes = orientation >= 5 && orientation <= 8;
    const orientedWidth = swapsAxes ? bitmap.height : bitmap.width;
    const orientedHeight = swapsAxes ? bitmap.width : bitmap.height;
    const scale = Math.min(
      1,
      PROFILE_MEDIA_ACCESSIBILITY_PREVIEW_DIMENSION / Math.max(orientedWidth, orientedHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(orientedWidth * scale));
    canvas.height = Math.max(1, Math.round(orientedHeight * scale));
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Image preview could not be prepared.");
    }
    if (orientation === 1) {
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    } else {
      drawOrientedBitmap(context, bitmap, orientation, canvas.width, canvas.height);
    }
    const blob = await canvasToWebp(canvas, 0.82);
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Image preview could not be prepared."));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
  } finally {
    bitmap.close();
  }
}
