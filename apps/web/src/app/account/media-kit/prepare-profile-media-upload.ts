const PROFILE_MEDIA_BROWSER_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const PROFILE_MEDIA_MAX_STORED_DIMENSION = 4_096;
const PROFILE_MEDIA_WEBP_QUALITIES = [0.88, 0.78, 0.68] as const;
const PROFILE_MEDIA_SCALE_STEPS = [1, 0.85, 0.7, 0.55] as const;

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

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Image could not be prepared for upload.");
  }

  try {
    const storedScale = Math.min(
      1,
      PROFILE_MEDIA_MAX_STORED_DIMENSION / Math.max(bitmap.width, bitmap.height),
    );

    for (const scaleStep of PROFILE_MEDIA_SCALE_STEPS) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * storedScale * scaleStep));
      canvas.height = Math.max(1, Math.round(bitmap.height * storedScale * scaleStep));
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
