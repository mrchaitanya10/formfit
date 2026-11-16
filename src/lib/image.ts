import { type ImageKind, UserError, sniffFile, validateImageFile } from './files';
import { LIMITS } from './limits';

export interface LoadedImage {
  file: File;
  kind: ImageKind;
  bitmap: ImageBitmap;
  width: number;
  height: number;
  hasAlpha: boolean;
}

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new UserError('Your browser could not create a drawing surface. Close other tabs and try again.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** Frees the memory behind a canvas straight away instead of waiting for garbage collection. */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** Decodes an image (respecting its EXIF orientation). Throws UserError for bad files. */
export async function decodeImage(file: File): Promise<ImageBitmap> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UserError(`“${file.name}” could not be opened. The file may be damaged or incomplete.`);
  }
  if (bitmap.width * bitmap.height > LIMITS.imagePixels) {
    const megapixels = Math.round((bitmap.width * bitmap.height) / 1_000_000);
    bitmap.close();
    throw new UserError(
      `“${file.name}” is ${megapixels} megapixels. Images up to ${LIMITS.imagePixels / 1_000_000} megapixels are supported.`,
    );
  }
  return bitmap;
}

function detectAlpha(bitmap: ImageBitmap): boolean {
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  const canvas = createCanvas(bitmap.width * scale, bitmap.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let transparent = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) {
      transparent = true;
      break;
    }
  }
  releaseCanvas(canvas);
  return transparent;
}

export async function loadImage(file: File): Promise<LoadedImage> {
  const kind = await validateImageFile(file);
  const bitmap = await decodeImage(file);
  const hasAlpha = kind === 'jpeg' ? false : detectAlpha(bitmap);
  return { file, kind, bitmap, width: bitmap.width, height: bitmap.height, hasAlpha };
}

/* ---------- Crop geometry ---------- */

/**
 * How the source image sits inside the output frame.
 * zoom 1 means the image just covers the frame; x and y move it by a fraction of the frame size.
 */
export interface CropState {
  zoom: number;
  x: number;
  y: number;
  /** Clockwise rotation in degrees. */
  rotation: number;
}

export const MAX_ZOOM = 8;
export const DEFAULT_CROP: CropState = { zoom: 1, x: 0, y: 0, rotation: 0 };

interface Geometry {
  /** Size of the rotated image's bounding box in source pixels. */
  boxW: number;
  boxH: number;
  /** Scale at which the image exactly covers the frame. */
  cover: number;
  /** Smallest allowed zoom: the whole image fits inside the frame. */
  minZoom: number;
}

export function cropGeometry(srcW: number, srcH: number, outW: number, outH: number, rotation: number): Geometry {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const boxW = srcW * cos + srcH * sin;
  const boxH = srcW * sin + srcH * cos;
  const cover = Math.max(outW / boxW, outH / boxH);
  const contain = Math.min(outW / boxW, outH / boxH);
  return { boxW, boxH, cover, minZoom: contain / cover };
}

/** Keeps zoom in range and stops the image being dragged away from the frame. */
export function clampCrop(crop: CropState, srcW: number, srcH: number, outW: number, outH: number): CropState {
  const g = cropGeometry(srcW, srcH, outW, outH, crop.rotation);
  const zoom = Math.min(MAX_ZOOM, Math.max(g.minZoom, crop.zoom));
  const drawnW = g.boxW * g.cover * zoom;
  const drawnH = g.boxH * g.cover * zoom;
  const limitX = Math.max(0, (drawnW - outW) / 2) / outW;
  const limitY = Math.max(0, (drawnH - outH) / 2) / outH;
  return {
    zoom,
    rotation: crop.rotation,
    x: Math.min(limitX, Math.max(-limitX, crop.x)),
    y: Math.min(limitY, Math.max(-limitY, crop.y)),
  };
}

/**
 * Draws the crop into a context whose coordinate space is outW × outH.
 * `source` may be a lower-resolution copy of the image; srcW/srcH are always the original size.
 */
export function drawCrop(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
  crop: CropState,
  background: string | null,
): void {
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, outW, outH);
  } else {
    ctx.clearRect(0, 0, outW, outH);
  }
  const g = cropGeometry(srcW, srcH, outW, outH, crop.rotation);
  const scale = g.cover * crop.zoom;
  ctx.save();
  ctx.translate(outW / 2 + crop.x * outW, outH / 2 + crop.y * outH);
  ctx.rotate((crop.rotation * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.drawImage(source, -srcW / 2, -srcH / 2, srcW, srcH);
  ctx.restore();
}

/** Halves an image repeatedly; gives much cleaner results than one large downscale. */
function halveUntil(source: CanvasImageSource, width: number, height: number, targetScale: number): CanvasImageSource {
  let current = source;
  let w = width;
  let h = height;
  let scale = 1;
  while (scale * 0.5 >= targetScale && w > 2 && h > 2) {
    const next = createCanvas(w / 2, h / 2);
    context2d(next).drawImage(current, 0, 0, next.width, next.height);
    if (current instanceof HTMLCanvasElement) releaseCanvas(current);
    current = next;
    w = next.width;
    h = next.height;
    scale *= 0.5;
  }
  return current;
}

/** Renders the final crop at exactly outW × outH pixels. */
export function renderOutputCanvas(
  image: LoadedImage,
  outW: number,
  outH: number,
  crop: CropState,
  background: string | null,
): HTMLCanvasElement {
  const canvas = createCanvas(outW, outH);
  const ctx = context2d(canvas);
  const g = cropGeometry(image.width, image.height, outW, outH, crop.rotation);
  const source = halveUntil(image.bitmap, image.width, image.height, g.cover * crop.zoom);
  drawCrop(ctx, source, image.width, image.height, outW, outH, crop, background);
  if (source instanceof HTMLCanvasElement) releaseCanvas(source);
  return canvas;
}

/* ---------- Encoding ---------- */

export type ImageFormat = 'jpeg' | 'png';

export function canvasToBlob(canvas: HTMLCanvasElement, format: ImageFormat, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new UserError('The image could not be encoded. Try smaller dimensions.'))),
      `image/${format}`,
      quality,
    );
  });
}

export const MIN_JPEG_QUALITY = 0.05;
const MAX_SEARCH_STEPS = 7;

export interface EncodeResult {
  blob: Blob;
  /** JPEG quality used (0–1); null for PNG. */
  quality: number | null;
  /** Number of encodes performed. */
  attempts: number;
  /** null when no size limit was requested. */
  targetMet: boolean | null;
}

/**
 * Encodes a canvas, lowering JPEG quality step by step until the file fits `maxBytes`.
 * Pixel dimensions never change. When even the lowest quality is too large, the
 * smallest result is returned with targetMet = false.
 */
export async function encodeWithLimit(
  canvas: HTMLCanvasElement,
  format: ImageFormat,
  maxBytes: number | null,
  maxQuality: number,
  isStale: () => boolean = () => false,
): Promise<EncodeResult> {
  if (format === 'png') {
    const blob = await canvasToBlob(canvas, 'png');
    return { blob, quality: null, attempts: 1, targetMet: maxBytes === null ? null : blob.size <= maxBytes };
  }

  const first = await canvasToBlob(canvas, 'jpeg', maxQuality);
  if (maxBytes === null) return { blob: first, quality: maxQuality, attempts: 1, targetMet: null };
  if (first.size <= maxBytes) return { blob: first, quality: maxQuality, attempts: 1, targetMet: true };

  const smallest = await canvasToBlob(canvas, 'jpeg', MIN_JPEG_QUALITY);
  if (smallest.size > maxBytes || maxQuality <= MIN_JPEG_QUALITY) {
    return { blob: smallest, quality: MIN_JPEG_QUALITY, attempts: 2, targetMet: smallest.size <= maxBytes };
  }

  // Binary search for the highest quality that still fits.
  let best = { blob: smallest, quality: MIN_JPEG_QUALITY };
  let low = MIN_JPEG_QUALITY;
  let high = maxQuality;
  let attempts = 2;
  for (let step = 0; step < MAX_SEARCH_STEPS && high - low > 0.01; step++) {
    if (isStale()) break;
    const mid = (low + high) / 2;
    const blob = await canvasToBlob(canvas, 'jpeg', mid);
    attempts++;
    if (blob.size <= maxBytes) {
      best = { blob, quality: mid };
      low = mid;
    } else {
      high = mid;
    }
  }
  return { blob: best.blob, quality: best.quality, attempts, targetMet: true };
}

/* ---------- Verification ---------- */

export interface ImageCheck {
  actualKind: string;
  actualWidth: number;
  actualHeight: number;
  actualBytes: number;
  formatOk: boolean;
  dimensionsOk: boolean;
  /** null when no size limit was requested. */
  sizeOk: boolean | null;
  allOk: boolean;
}

/** Re-reads the exported file and measures it, rather than trusting what was requested. */
export async function verifyImageBlob(
  blob: Blob,
  expected: { format: ImageFormat; width: number; height: number; maxBytes: number | null },
): Promise<ImageCheck> {
  const actualKind = (await sniffFile(blob)) ?? 'unknown';
  let actualWidth = 0;
  let actualHeight = 0;
  try {
    const bitmap = await createImageBitmap(blob);
    actualWidth = bitmap.width;
    actualHeight = bitmap.height;
    bitmap.close();
  } catch {
    // Leave the dimensions at 0 so the check fails visibly.
  }
  const formatOk = actualKind === expected.format;
  const dimensionsOk = actualWidth === expected.width && actualHeight === expected.height;
  const sizeOk = expected.maxBytes === null ? null : blob.size <= expected.maxBytes;
  return {
    actualKind,
    actualWidth,
    actualHeight,
    actualBytes: blob.size,
    formatOk,
    dimensionsOk,
    sizeOk,
    allOk: formatOk && dimensionsOk && sizeOk !== false,
  };
}
