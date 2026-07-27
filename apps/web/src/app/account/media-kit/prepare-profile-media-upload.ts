const PROFILE_MEDIA_BROWSER_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const PROFILE_MEDIA_MAX_STORED_DIMENSION = 4_096;
const PROFILE_MEDIA_MAX_SOURCE_PIXELS = 32_000_000;
const PROFILE_MEDIA_MAX_PREPARED_PIXELS = 12_000_000;
const PROFILE_MEDIA_WEBP_QUALITIES = [0.88, 0.78, 0.68] as const;
const PROFILE_MEDIA_SCALE_STEPS = [1, 0.85, 0.7, 0.55] as const;

type ImageDimensions = { width: number; height: number };

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;

  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const segmentLength = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (segmentLength < 2 || offset + segmentLength + 2 > bytes.length) return null;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
      };
    }
    offset += segmentLength + 2;
  }

  return null;
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

async function readImageDimensions(file: File): Promise<ImageDimensions | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  return jpegDimensions(bytes) ?? webpDimensions(bytes);
}

function webpFileName(fileName: string) {
  const baseName = fileName.replace(/\.[^.]+$/, "") || "image";
  return `${baseName}.webp`;
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

export async function prepareProfileMediaUpload(file: File): Promise<File> {
  if (file.size <= PROFILE_MEDIA_BROWSER_UPLOAD_MAX_BYTES) {
    return file;
  }

  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
    throw new Error("SVG images must be 4 MB or smaller.");
  }

  const dimensions = await readImageDimensions(file);
  if (
    dimensions === null ||
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    dimensions.width * dimensions.height > PROFILE_MEDIA_MAX_SOURCE_PIXELS
  ) {
    throw new Error("Image dimensions are too large.");
  }
  const preparedScale = Math.min(
    1,
    PROFILE_MEDIA_MAX_STORED_DIMENSION / Math.max(dimensions.width, dimensions.height),
    Math.sqrt(PROFILE_MEDIA_MAX_PREPARED_PIXELS / (dimensions.width * dimensions.height)),
  );
  const preparedWidth = Math.max(1, Math.round(dimensions.width * preparedScale));
  const preparedHeight = Math.max(1, Math.round(dimensions.height * preparedScale));

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      resizeWidth: preparedWidth,
      resizeHeight: preparedHeight,
      resizeQuality: "high",
    });
  } catch {
    throw new Error("Image could not be prepared for upload.");
  }

  try {
    for (const scaleStep of PROFILE_MEDIA_SCALE_STEPS) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scaleStep));
      canvas.height = Math.max(1, Math.round(bitmap.height * scaleStep));
      const context = canvas.getContext("2d");

      if (context === null) {
        throw new Error("Image could not be prepared for upload.");
      }

      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      for (const quality of PROFILE_MEDIA_WEBP_QUALITIES) {
        const blob = await canvasToWebp(canvas, quality);
        if (blob.size <= PROFILE_MEDIA_BROWSER_UPLOAD_MAX_BYTES) {
          return new File([blob], webpFileName(file.name), {
            type: "image/webp",
            lastModified: file.lastModified,
          });
        }
      }
    }
  } finally {
    bitmap.close();
  }

  throw new Error("Image could not be prepared for upload.");
}
