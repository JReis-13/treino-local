export const MAX_SHARE_PHOTO_BYTES = 30 * 1024 * 1024;
export const MAX_SHARE_PHOTO_EDGE = 1600;

const photoTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"]);

export function photoSelectionError(file: Pick<File, "type" | "size">): string | undefined {
  if (!photoTypes.has(file.type.toLowerCase())) return "Choose a JPEG, PNG, WebP, AVIF, or phone photo.";
  if (!file.size || file.size > MAX_SHARE_PHOTO_BYTES) return "This photo is too large or empty. Choose one under 30 MB.";
}

export interface DecodedShareImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

/** Browser decoders apply EXIF orientation; the original file is never retained after processing. */
export async function decodeShareImage(blob: Blob): Promise<DecodedShareImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      if (bitmap.width && bitmap.height) return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
      bitmap.close();
    } catch { /* The platform image element may support formats unavailable to ImageBitmap. */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("Photo has no dimensions.");
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("This photo could not be read. Choose another image.");
  }
}

export function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The image could not be prepared.")), type, quality));
}

/** Re-encoding bounds pixel dimensions and strips EXIF/GPS metadata from the selected photo. */
export async function processSharePhoto(file: File): Promise<Blob> {
  const error = photoSelectionError(file);
  if (error) throw new Error(error);
  const decoded = await decodeShareImage(file);
  try {
    const scale = Math.min(1, MAX_SHARE_PHOTO_EDGE / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo processing is unavailable on this device.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    return await canvasBlob(canvas, "image/jpeg", 0.88);
  } finally {
    decoded.close();
  }
}
