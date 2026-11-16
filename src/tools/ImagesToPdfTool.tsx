import { useEffect, useRef, useState } from 'react';
import { Dropzone } from '../components/Dropzone';
import { ToolPage } from '../components/Layout';
import { OutputActions } from '../components/OutputActions';
import { PdfPreview } from '../components/PdfPreview';
import { moveItem, useDragReorder } from '../components/reorder';
import { Alert, Button, Card, Facts, Field, ProgressBar, Segmented, inputClass } from '../components/ui';
import { IMAGE_ACCEPT, type ImageKind, errorMessage, isAbortError, pdfBlob, validateImageFile } from '../lib/files';
import { formatBytes } from '../lib/format';
import { decodeImage } from '../lib/image';
import { LIMITS } from '../lib/limits';
import { type ImagesToPdfOptions, MAX_MARGIN_MM, type QuarterTurn, countPdfPages, imagesToPdf } from '../lib/pdfBuild';

interface Item {
  id: string;
  file: File;
  kind: ImageKind;
  url: string;
  width: number;
  height: number;
  rotation: QuarterTurn;
}

interface Result {
  bytes: Uint8Array;
  blob: Blob;
  pages: number;
}

export function ImagesToPdfTool() {
  const [items, setItems] = useState<Item[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [pageSize, setPageSize] = useState<ImagesToPdfOptions['pageSize']>('a4');
  const [orientation, setOrientation] = useState<ImagesToPdfOptions['orientation']>('portrait');
  const [marginText, setMarginText] = useState('10');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Release thumbnails and stop any running job when the tool is closed.
  useEffect(
    () => () => {
      controller.current?.abort();
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    },
    [],
  );

  /** Any change to the list or settings makes an existing PDF outdated. */
  function invalidate() {
    controller.current?.abort();
    setResult(null);
    setRunError(null);
    setProgress(null);
  }

  async function addFiles(files: File[]) {
    invalidate();
    setAdding(true);
    const problems: string[] = [];
    const added: Item[] = [];
    for (const file of files) {
      if (itemsRef.current.length + added.length >= LIMITS.imagesPerPdf) {
        problems.push(`Only ${LIMITS.imagesPerPdf} images can be combined at once; the rest were not added.`);
        break;
      }
      try {
        const kind = await validateImageFile(file);
        const bitmap = await decodeImage(file);
        added.push({ id: crypto.randomUUID(), file, kind, url: URL.createObjectURL(file), width: bitmap.width, height: bitmap.height, rotation: 0 });
        bitmap.close();
      } catch (error) {
        problems.push(errorMessage(error));
      }
    }
    setItems((current) => [...current, ...added]);
    setErrors(problems);
    setAdding(false);
  }

  function updateItems(next: (current: Item[]) => Item[]) {
    invalidate();
    setItems(next);
  }

  function remove(id: string) {
    const item = items.find((i) => i.id === id);
    if (item) URL.revokeObjectURL(item.url);
    updateItems((current) => current.filter((i) => i.id !== id));
  }

  const rotate = (id: string) =>
    updateItems((current) => current.map((i) => (i.id === id ? { ...i, rotation: ((i.rotation + 90) % 360) as QuarterTurn } : i)));
  const move = (from: number, to: number) => updateItems((current) => moveItem(current, from, to));
  const drag = useDragReorder(move);

  const margin = Number(marginText);
  const marginError =
    marginText.trim() === '' || !Number.isFinite(margin) || margin < 0 || margin > MAX_MARGIN_MM ? `Enter 0–${MAX_MARGIN_MM} mm.` : null;
  const running = progress !== null;

  async function run() {
    invalidate();
    const abort = new AbortController();
    controller.current = abort;
    setProgress({ done: 0, total: items.length });
    try {
      const bytes = await imagesToPdf(
        items.map(({ file, kind, rotation }) => ({ file, kind, rotation })),
        { pageSize, orientation, marginMm: margin },
        abort.signal,
        (done, total) => setProgress({ done, total }),
      );
      const pages = await countPdfPages(bytes);
      if (abort.signal.aborted) return;
      setResult({ bytes, blob: pdfBlob(bytes), pages });
    } catch (error) {
      if (!isAbortError(error) && !abort.signal.aborted) setRunError(errorMessage(error));
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setProgress(null);
      }
    }
  }

  return (
    <ToolPage title="Images to PDF" intro="Combine photos or scans into one PDF, one image per page, in the order you choose.">
      <Card title="Upload" step={1}>
        <Dropzone
          accept={IMAGE_ACCEPT}
          multiple
          compact={items.length > 0}
          title={items.length ? 'Add more images' : 'Add images'}
          hint={`JPEG, PNG or WebP · up to ${LIMITS.imagesPerPdf} images, ${formatBytes(LIMITS.imageBytes)} each`}
          onFiles={(files) => void addFiles(files)}
        />
        {adding && <p className="mt-3 text-sm text-navy-600" role="status">Reading images…</p>}
        {errors.length > 0 && (
          <div className="mt-3">
            <Alert tone="error" title="Some files were not added">
              <ul className="list-disc pl-5">
                {errors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </Alert>
          </div>
        )}
      </Card>

      {items.length > 0 && (
        <Card title={`Order and rotation · ${items.length} ${items.length === 1 ? 'image' : 'images'}`} step={2}>
          <p className="mb-3 text-xs text-navy-500">Drag to reorder, or use the arrow buttons. The first image becomes page 1.</p>
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item, index) => (
              <li
                key={item.id}
                {...drag.rowProps(index)}
                className={`rounded-lg border bg-white p-2 ${drag.overIndex === index && drag.dragIndex !== index ? 'border-brand ring-2 ring-blue-200' : 'border-navy-200'} ${drag.dragIndex === index ? 'opacity-50' : ''}`}
              >
                <div className="flex aspect-square cursor-grab items-center justify-center overflow-hidden rounded bg-navy-100">
                  <img
                    src={item.url}
                    alt={`Page ${index + 1}: ${item.file.name}`}
                    draggable={false}
                    className="max-h-full max-w-full object-contain transition-transform"
                    style={{ transform: `rotate(${item.rotation}deg)` }}
                  />
                </div>
                <p className="mt-2 truncate text-xs font-medium text-ink" title={item.file.name}>
                  {index + 1}. {item.file.name}
                </p>
                <p className="text-xs text-navy-500 tabular-nums">
                  {item.width} × {item.height} · {formatBytes(item.file.size)}
                </p>
                <div className="mt-2 grid grid-cols-4 gap-1">
                  <Button small className="px-0" aria-label={`Move ${item.file.name} earlier`} disabled={index === 0} onClick={() => move(index, index - 1)}>
                    ←
                  </Button>
                  <Button small className="px-0" aria-label={`Move ${item.file.name} later`} disabled={index === items.length - 1} onClick={() => move(index, index + 1)}>
                    →
                  </Button>
                  <Button small className="px-0" aria-label={`Rotate ${item.file.name}`} onClick={() => rotate(item.id)}>
                    ⟳
                  </Button>
                  <Button small variant="danger" className="px-0" aria-label={`Remove ${item.file.name}`} onClick={() => remove(item.id)}>
                    ✕
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {items.length > 0 && (
        <Card title="Page settings" step={3}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-6 gap-y-4">
              <div>
                <p className="mb-1 text-sm font-medium text-ink">Page size</p>
                <Segmented
                  label="Page size"
                  value={pageSize}
                  onChange={(value) => {
                    invalidate();
                    setPageSize(value);
                  }}
                  options={[
                    { value: 'a4', label: 'A4' },
                    { value: 'image', label: 'Same as image' },
                  ]}
                />
              </div>
              {pageSize === 'a4' && (
                <div>
                  <p className="mb-1 text-sm font-medium text-ink">Orientation</p>
                  <Segmented
                    label="Orientation"
                    value={orientation}
                    onChange={(value) => {
                      invalidate();
                      setOrientation(value);
                    }}
                    options={[
                      { value: 'portrait', label: 'Portrait' },
                      { value: 'landscape', label: 'Landscape' },
                      { value: 'auto', label: 'Match each image' },
                    ]}
                  />
                </div>
              )}
              <div className="w-32">
                <Field label="Margin (mm)" htmlFor="pdf-margin" error={marginError}>
                  <input
                    id="pdf-margin"
                    inputMode="decimal"
                    value={marginText}
                    onChange={(e) => {
                      invalidate();
                      setMarginText(e.target.value);
                    }}
                    className={inputClass}
                  />
                </Field>
              </div>
            </div>
            <p className="text-xs text-navy-500">
              Each image is scaled to fit inside the margins and centred, never stretched. Images over {LIMITS.pdfImageLongEdge} px on the long edge are
              scaled down. With “Same as image”, the page takes the image’s orientation.
            </p>
            {running ? (
              <div className="space-y-3">
                <ProgressBar value={(progress.done / Math.max(1, progress.total)) * 100} label={`Adding image ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`} />
                <Button onClick={() => controller.current?.abort()}>Cancel</Button>
              </div>
            ) : (
              <div className="sticky bottom-0 -mx-4 border-t border-navy-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:p-0">
                <Button variant="primary" className="w-full sm:w-auto" disabled={!!marginError || adding} onClick={() => void run()}>
                  Create PDF
                </Button>
              </div>
            )}
            {runError && <Alert tone="error">{runError}</Alert>}
          </div>
        </Card>
      )}

      {result && (
        <Card title="Preview and download" step={4}>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Facts
                rows={[
                  ['Pages', String(result.pages)],
                  ['File size', `${formatBytes(result.blob.size)} (${result.blob.size.toLocaleString('en')} bytes)`],
                  ['Format', 'PDF'],
                ]}
              />
              <PdfPreview bytes={result.bytes} />
            </div>
            <OutputActions blob={result.blob} suggestedName="images.pdf" kind="pdf" pages={result.pages} />
          </div>
        </Card>
      )}
    </ToolPage>
  );
}
