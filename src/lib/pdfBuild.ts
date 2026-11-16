import { PDFDocument } from 'pdf-lib';
import { type ImageKind, UserError, throwIfAborted } from './files';
import { canvasToBlob, context2d, createCanvas, decodeImage, releaseCanvas } from './image';
import { LIMITS } from './limits';

const MM_TO_PT = 72 / 25.4;
/** Image-sized pages treat one image pixel as 1/96 inch, the usual screen convention. */
const PX_TO_PT = 72 / 96;
const A4 = { width: 595.28, height: 841.89 };

export type QuarterTurn = 0 | 90 | 180 | 270;

export interface PdfImageInput {
  file: File;
  kind: ImageKind;
  rotation: QuarterTurn;
}

export interface ImagesToPdfOptions {
  pageSize: 'a4' | 'image';
  /** Only used for A4. "auto" picks the orientation that suits each image. */
  orientation: 'portrait' | 'landscape' | 'auto';
  marginMm: number;
}

export const MAX_MARGIN_MM = 50;

/** Draws the image upright (with the chosen rotation) and returns it encoded for embedding. */
async function prepareImage(input: PdfImageInput): Promise<{ bytes: ArrayBuffer; png: boolean; width: number; height: number }> {
  const bitmap = await decodeImage(input.file);
  try {
    const swap = input.rotation === 90 || input.rotation === 270;
    const fullW = swap ? bitmap.height : bitmap.width;
    const fullH = swap ? bitmap.width : bitmap.height;
    const scale = Math.min(1, LIMITS.pdfImageLongEdge / Math.max(fullW, fullH));
    const canvas = createCanvas(fullW * scale, fullH * scale);
    const ctx = context2d(canvas);
    const png = input.kind === 'png';
    if (!png) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((input.rotation * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    // PNG sources (screenshots, scans of text) stay lossless; photos are stored as high-quality JPEG.
    const blob = await canvasToBlob(canvas, png ? 'png' : 'jpeg', 0.92);
    const result = { bytes: await blob.arrayBuffer(), png, width: canvas.width, height: canvas.height };
    releaseCanvas(canvas);
    return result;
  } finally {
    bitmap.close();
  }
}

/** Builds one PDF with one image per page, in the order given. Images are scaled to fit, never stretched. */
export async function imagesToPdf(
  inputs: PdfImageInput[],
  options: ImagesToPdfOptions,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const margin = options.marginMm * MM_TO_PT;
  const pdf = await PDFDocument.create();
  for (let i = 0; i < inputs.length; i++) {
    throwIfAborted(signal);
    onProgress(i, inputs.length);
    const prepared = await prepareImage(inputs[i]);
    const image = prepared.png ? await pdf.embedPng(prepared.bytes) : await pdf.embedJpg(prepared.bytes);

    let pageW: number;
    let pageH: number;
    if (options.pageSize === 'image') {
      pageW = prepared.width * PX_TO_PT + margin * 2;
      pageH = prepared.height * PX_TO_PT + margin * 2;
    } else {
      const landscape =
        options.orientation === 'landscape' || (options.orientation === 'auto' && prepared.width > prepared.height);
      pageW = landscape ? A4.height : A4.width;
      pageH = landscape ? A4.width : A4.height;
    }
    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2;
    const scale = Math.min(availW / prepared.width, availH / prepared.height);
    const drawW = prepared.width * scale;
    const drawH = prepared.height * scale;
    pdf.addPage([pageW, pageH]).drawImage(image, {
      x: (pageW - drawW) / 2,
      y: (pageH - drawH) / 2,
      width: drawW,
      height: drawH,
    });
    // Yield so progress can paint and cancellation can be noticed.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throwIfAborted(signal);
  onProgress(inputs.length, inputs.length);
  return pdf.save();
}

/** Opens a PDF for copying pages. Throws UserError for encrypted or unreadable files. */
export async function loadPdfForCopy(bytes: Uint8Array, fileName: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/encrypted/i.test(message)) {
      throw new UserError(
        `“${fileName}” is password-protected or encrypted, so its pages cannot be copied. Save an unprotected copy with the app that created it, then try again.`,
      );
    }
    console.error(error);
    throw new UserError(`“${fileName}” is damaged or uses PDF features this tool does not support.`);
  }
}

/** Joins whole PDFs in order. Page content is copied as-is, not re-rendered. */
export async function mergePdfs(
  sources: { bytes: Uint8Array; name: string }[],
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const output = await PDFDocument.create();
  for (let i = 0; i < sources.length; i++) {
    throwIfAborted(signal);
    onProgress(i, sources.length);
    const doc = await loadPdfForCopy(sources[i].bytes, sources[i].name);
    const pages = await output.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => output.addPage(page));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throwIfAborted(signal);
  onProgress(sources.length, sources.length);
  return { bytes: await output.save(), pageCount: output.getPageCount() };
}

/** Copies the given 1-based pages, in the given order, into a new PDF. */
export async function extractPages(bytes: Uint8Array, fileName: string, pages: number[]): Promise<Uint8Array> {
  const doc = await loadPdfForCopy(bytes, fileName);
  const output = await PDFDocument.create();
  const copied = await output.copyPages(doc, pages.map((page) => page - 1));
  copied.forEach((page) => output.addPage(page));
  return output.save();
}

/** Counts pages by re-reading finished bytes — used to verify an output before reporting success. */
export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPageCount();
}
