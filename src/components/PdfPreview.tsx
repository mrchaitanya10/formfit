import { useEffect, useRef, useState } from 'react';
import { errorMessage, isAbortError } from '../lib/files';
import { context2d, releaseCanvas } from '../lib/image';
import { type PDFDocumentProxy, openPdf, renderPageToCanvas } from '../lib/pdfjs';
import { Alert, Button } from './ui';

/** Draws one page of an open PDF, sized to its container. Cancels and discards outdated renders. */
export function PdfPageCanvas({ doc, pageNumber, label }: { doc: PDFDocumentProxy; pageNumber: number; label: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const resize = new ResizeObserver(() => setWidth(Math.round(wrap.clientWidth)));
    resize.observe(wrap);
    // Only render once the page scrolls near the screen.
    const intersect = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), {
      rootMargin: '300px',
    });
    intersect.observe(wrap);
    return () => {
      resize.disconnect();
      intersect.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!visible || width === 0) return;
    const controller = new AbortController();
    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rendered = await renderPageToCanvas(page, (width * dpr) / base.width, controller.signal);
        const canvas = canvasRef.current;
        if (canvas && !controller.signal.aborted) {
          canvas.width = rendered.width;
          canvas.height = rendered.height;
          context2d(canvas).drawImage(rendered, 0, 0);
        }
        releaseCanvas(rendered);
        page.cleanup();
      } catch (error) {
        if (!isAbortError(error) && !controller.signal.aborted) console.error(error);
      }
    })();
    return () => controller.abort();
  }, [doc, pageNumber, width, visible]);

  return (
    <div ref={wrapRef} className="w-full">
      <canvas ref={canvasRef} role="img" aria-label={label} className="block h-auto w-full bg-white ring-1 ring-navy-200" />
    </div>
  );
}

/** Opens PDF bytes and closes the document again when the bytes change or the component unmounts. */
export function usePdfDocument(bytes: Uint8Array | null, fileName?: string) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDoc(null);
    setError(null);
    if (!bytes) return;
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    openPdf(bytes, fileName)
      .then((result) => {
        opened = result;
        if (cancelled) void result.loadingTask.destroy();
        else setDoc(result);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
      void opened?.loadingTask.destroy();
    };
  }, [bytes, fileName]);
  return { doc, error };
}

/** Page-by-page preview of a finished PDF so its readability can be checked before download. */
export function PdfPreview({ bytes }: { bytes: Uint8Array }) {
  const { doc, error } = usePdfDocument(bytes);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [bytes]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!doc) return <p className="text-sm text-navy-500">Loading preview…</p>;
  const current = Math.min(page, doc.numPages);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Button small disabled={current <= 1} onClick={() => setPage(current - 1)}>
          Previous
        </Button>
        <p className="text-sm text-navy-700 tabular-nums" aria-live="polite">
          Page {current} of {doc.numPages}
        </p>
        <Button small disabled={current >= doc.numPages} onClick={() => setPage(current + 1)}>
          Next
        </Button>
      </div>
      <div className="mx-auto max-w-xl rounded-lg bg-navy-100 p-2">
        <PdfPageCanvas key={current} doc={doc} pageNumber={current} label={`Preview of page ${current}`} />
      </div>
    </div>
  );
}
