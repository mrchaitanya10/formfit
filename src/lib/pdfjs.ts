import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import { UserError, throwIfAborted } from './files';
import { context2d, createCanvas, releaseCanvas } from './image';
import { LIMITS } from './limits';

// The worker and its data files are copied into /pdfjs by scripts/copy-pdfjs-assets.mjs,
// so nothing is fetched from another site.
const ASSET_BASE = new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI).href;
GlobalWorkerOptions.workerSrc = `${ASSET_BASE}pdf.worker.min.mjs`;

export type { PDFDocumentProxy, PDFPageProxy };

/** Opens a PDF for rendering. The bytes are copied because PDF.js takes ownership of its input. */
export async function openPdf(bytes: Uint8Array, fileName = 'This PDF'): Promise<PDFDocumentProxy> {
  try {
    return await getDocument({
      data: bytes.slice(),
      cMapUrl: `${ASSET_BASE}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
      wasmUrl: `${ASSET_BASE}wasm/`,
      iccUrl: `${ASSET_BASE}iccs/`,
    }).promise;
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'PasswordException') {
      throw new UserError(
        `“${fileName}” is password-protected, so it cannot be opened here. Save an unprotected copy with the app that created it, then try again.`,
      );
    }
    if (name === 'InvalidPDFException' || name === 'FormatError') {
      throw new UserError(`“${fileName}” is damaged or is not a valid PDF, so it cannot be opened.`);
    }
    console.error(error);
    throw new UserError(`“${fileName}” uses PDF features this tool does not support, so it cannot be opened.`);
  }
}

/** Renders one page to a new canvas. `scale` 1 means 72 pixels per inch. */
export async function renderPageToCanvas(
  page: PDFPageProxy,
  scale: number,
  signal?: AbortSignal,
): Promise<HTMLCanvasElement> {
  throwIfAborted(signal);
  let viewport = page.getViewport({ scale });
  const pixels = viewport.width * viewport.height;
  if (pixels > LIMITS.canvasPixels) {
    viewport = page.getViewport({ scale: scale * Math.sqrt(LIMITS.canvasPixels / pixels) });
  }
  const canvas = createCanvas(viewport.width, viewport.height);
  const task = page.render({ canvas, canvasContext: context2d(canvas), viewport });
  const onAbort = () => task.cancel();
  signal?.addEventListener('abort', onAbort);
  try {
    await task.promise;
  } catch (error) {
    releaseCanvas(canvas);
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  return canvas;
}

function containsAscii(bytes: Uint8Array, text: string): boolean {
  const needle = Array.from(text, (ch) => ch.charCodeAt(0));
  const first = needle[0];
  outer: for (let i = bytes.indexOf(first); i !== -1 && i <= bytes.length - needle.length; i = bytes.indexOf(first, i + 1)) {
    for (let j = 1; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** Quick check on raw bytes: signed PDFs carry a /ByteRange entry. */
export function bytesLookSigned(bytes: Uint8Array): boolean {
  return containsAscii(bytes, '/ByteRange');
}

/** True when the PDF appears to contain a digital signature or signature field. */
export async function pdfLooksSigned(doc: PDFDocumentProxy, bytes: Uint8Array): Promise<boolean> {
  if (bytesLookSigned(bytes)) return true;
  try {
    const fields = await doc.getFieldObjects();
    if (!fields) return false;
    return Object.values(fields).some((group) => group.some((field) => (field as { type?: string }).type === 'signature'));
  } catch {
    return false;
  }
}
