import { PDFDocument } from 'pdf-lib';
import { throwIfAborted } from './files';
import { canvasToBlob, context2d, createCanvas, releaseCanvas } from './image';
import { type PDFDocumentProxy, renderPageToCanvas } from './pdfjs';

export interface CompressSettings {
  /** null means no size target: one pass at the chosen settings. */
  maxBytes: number | null;
  /** Rendering resolution in pixels per inch. */
  dpi: number;
  /** JPEG quality, 0–1. */
  quality: number;
  grayscale: boolean;
}

export interface CompressProgress {
  attempt: number;
  maxAttempts: number;
  page: number;
  pageCount: number;
}

export interface CompressAttempt {
  dpi: number;
  quality: number;
  bytes: number;
}

export interface CompressResult {
  bytes: Uint8Array;
  pageCount: number;
  attempts: CompressAttempt[];
  /** null when no size target was set. */
  targetMet: boolean | null;
}

export const MIN_DPI = 50;
export const MIN_QUALITY = 0.2;

/** Each later step renders smaller and/or at lower quality. At most this many attempts are made. */
const LADDER = [
  { scale: 1, quality: 1 },
  { scale: 1, quality: 0.75 },
  { scale: 0.8, quality: 0.65 },
  { scale: 0.65, quality: 0.55 },
  { scale: 0.5, quality: 0.45 },
  { scale: 0.4, quality: 0.35 },
];
export const MAX_COMPRESS_ATTEMPTS = LADDER.length;

/** Rough relative file size of a ladder step, used to skip steps that clearly will not be enough. */
function sizeFactor(step: { scale: number; quality: number }): number {
  return step.scale ** 2 * step.quality ** 1.3;
}

function toGrayscale(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const gray = createCanvas(canvas.width, canvas.height);
  const ctx = context2d(gray);
  ctx.filter = 'grayscale(1)';
  ctx.drawImage(canvas, 0, 0);
  releaseCanvas(canvas);
  return gray;
}

/** Renders every page to a JPEG and builds a new PDF with the same page sizes and order. */
async function rasterize(
  source: PDFDocumentProxy,
  dpi: number,
  quality: number,
  grayscale: boolean,
  signal: AbortSignal,
  onPage: (page: number) => void,
): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  for (let number = 1; number <= source.numPages; number++) {
    throwIfAborted(signal);
    onPage(number);
    const page = await source.getPage(number);
    // The viewport already accounts for page rotation, so orientation is preserved.
    const size = page.getViewport({ scale: 1 });
    let canvas = await renderPageToCanvas(page, dpi / 72, signal);
    if (grayscale) canvas = toGrayscale(canvas);
    const jpeg = await canvasToBlob(canvas, 'jpeg', quality);
    releaseCanvas(canvas);
    page.cleanup();
    const image = await output.embedJpg(await jpeg.arrayBuffer());
    output.addPage([size.width, size.height]).drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
  }
  throwIfAborted(signal);
  return output.save();
}

/**
 * “Smaller PDF — converts pages to images.”
 * Tries progressively stronger settings until the file fits, up to MAX_COMPRESS_ATTEMPTS.
 * Returns the smallest result even when the target was not reached.
 */
export async function compressPdfAsImages(
  source: PDFDocumentProxy,
  settings: CompressSettings,
  signal: AbortSignal,
  onProgress: (progress: CompressProgress) => void,
): Promise<CompressResult> {
  const attempts: CompressAttempt[] = [];
  const maxAttempts = settings.maxBytes === null ? 1 : MAX_COMPRESS_ATTEMPTS;
  let best: Uint8Array | null = null;
  let step = 0;

  while (true) {
    const dpi = Math.max(MIN_DPI, Math.round(settings.dpi * LADDER[step].scale));
    const quality = Math.max(MIN_QUALITY, settings.quality * LADDER[step].quality);
    const attempt = attempts.length + 1;
    const bytes = await rasterize(source, dpi, quality, settings.grayscale, signal, (page) =>
      onProgress({ attempt, maxAttempts, page, pageCount: source.numPages }),
    );
    attempts.push({ dpi, quality, bytes: bytes.length });
    if (!best || bytes.length < best.length) best = bytes;

    if (settings.maxBytes === null) return { bytes: best, pageCount: source.numPages, attempts, targetMet: null };
    if (bytes.length <= settings.maxBytes) return { bytes, pageCount: source.numPages, attempts, targetMet: true };
    if (step === LADDER.length - 1) return { bytes: best, pageCount: source.numPages, attempts, targetMet: false };

    // Jump to the first later step whose estimated size fits; otherwise go straight to the strongest.
    const needed = (settings.maxBytes / bytes.length) * 0.95;
    const current = sizeFactor(LADDER[step]);
    let next = LADDER.length - 1;
    for (let i = step + 1; i < LADDER.length; i++) {
      if (sizeFactor(LADDER[i]) / current <= needed) {
        next = i;
        break;
      }
    }
    step = next;
    // Let the browser repaint between attempts.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
