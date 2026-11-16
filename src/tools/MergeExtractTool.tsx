import { useEffect, useRef, useState } from 'react';
import { Dropzone } from '../components/Dropzone';
import { ToolPage } from '../components/Layout';
import { OutputActions } from '../components/OutputActions';
import { PdfPageCanvas, PdfPreview, usePdfDocument } from '../components/PdfPreview';
import { moveItem, useDragReorder } from '../components/reorder';
import { Alert, Button, Card, Facts, Field, ProgressBar, Segmented, inputClass } from '../components/ui';
import { PDF_ACCEPT, errorMessage, isAbortError, pdfBlob, validatePdfFile } from '../lib/files';
import { formatBytes, splitName } from '../lib/format';
import { LIMITS } from '../lib/limits';
import { formatPageRanges, parsePageRanges } from '../lib/pageRanges';
import { countPdfPages, extractPages, loadPdfForCopy, mergePdfs } from '../lib/pdfBuild';
import { bytesLookSigned } from '../lib/pdfjs';

const COPY_NOTE =
  'Pages are copied as they are, so text stays selectable and image quality is unchanged. Fillable form fields and bookmarks may not carry over.';

const SIGNED_NOTE =
  'appears to contain a digital signature. The new file is a rewritten copy, so it will not verify as signed. Keep the original where a signed version is needed.';

async function readPdf(file: File): Promise<{ bytes: Uint8Array; pages: number; signed: boolean }> {
  await validatePdfFile(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await loadPdfForCopy(bytes, file.name);
  return { bytes, pages: doc.getPageCount(), signed: bytesLookSigned(bytes) };
}

export function MergeExtractTool() {
  const [tab, setTab] = useState<'merge' | 'extract'>('merge');
  return (
    <ToolPage title="Merge and extract" intro="Join several PDFs into one, or pull selected pages out into a new PDF.">
      <Segmented
        label="Task"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'merge', label: 'Merge PDFs' },
          { value: 'extract', label: 'Extract pages' },
        ]}
      />
      {tab === 'merge' ? <MergePanel /> : <ExtractPanel />}
    </ToolPage>
  );
}

interface MergeItem {
  id: string;
  file: File;
  bytes: Uint8Array;
  pages: number;
  signed: boolean;
}

function MergePanel() {
  const [items, setItems] = useState<MergeItem[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ bytes: Uint8Array; blob: Blob; pages: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => () => controller.current?.abort(), []);

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
    const added: MergeItem[] = [];
    const total = () => [...itemsRef.current, ...added];
    for (const file of files) {
      if (total().length >= LIMITS.mergeFiles) {
        problems.push(`Up to ${LIMITS.mergeFiles} PDFs can be merged at once; the rest were not added.`);
        break;
      }
      try {
        const info = await readPdf(file);
        const pages = total().reduce((sum, item) => sum + item.pages, 0) + info.pages;
        const bytes = total().reduce((sum, item) => sum + item.file.size, 0) + file.size;
        if (pages > LIMITS.pdfPages || bytes > LIMITS.pdfBytes) {
          problems.push(
            `“${file.name}” was not added: the merged file would exceed ${LIMITS.pdfPages} pages or ${formatBytes(LIMITS.pdfBytes)}.`,
          );
          continue;
        }
        added.push({ id: crypto.randomUUID(), file, ...info });
      } catch (error) {
        problems.push(errorMessage(error));
      }
    }
    setItems((current) => [...current, ...added]);
    setErrors(problems);
    setAdding(false);
  }

  function updateItems(next: (current: MergeItem[]) => MergeItem[]) {
    invalidate();
    setItems(next);
  }
  const move = (from: number, to: number) => updateItems((current) => moveItem(current, from, to));
  const drag = useDragReorder(move);
  const totalPages = items.reduce((sum, item) => sum + item.pages, 0);
  const running = progress !== null;

  async function run() {
    invalidate();
    const abort = new AbortController();
    controller.current = abort;
    setProgress({ done: 0, total: items.length });
    try {
      const merged = await mergePdfs(
        items.map((item) => ({ bytes: item.bytes, name: item.file.name })),
        abort.signal,
        (done, total) => setProgress({ done, total }),
      );
      const pages = await countPdfPages(merged.bytes);
      if (abort.signal.aborted) return;
      if (pages !== totalPages) throw new Error(`Merged page count ${pages} does not match expected ${totalPages}`);
      setResult({ bytes: merged.bytes, blob: pdfBlob(merged.bytes), pages });
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
    <>
      <Card title="Upload" step={1}>
        <Dropzone
          accept={PDF_ACCEPT}
          multiple
          compact={items.length > 0}
          title={items.length ? 'Add more PDFs' : 'Add PDFs to merge'}
          hint={`Up to ${LIMITS.mergeFiles} PDFs · ${formatBytes(LIMITS.pdfBytes)} and ${LIMITS.pdfPages} pages in total`}
          onFiles={(files) => void addFiles(files)}
        />
        {adding && <p className="mt-3 text-sm text-navy-600" role="status">Reading PDFs…</p>}
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
        <Card title={`Order · ${items.length} ${items.length === 1 ? 'file' : 'files'}, ${totalPages} pages`} step={2}>
          <p className="mb-3 text-xs text-navy-500">Drag to reorder, or use the arrow buttons. Files are joined from top to bottom.</p>
          <ol className="space-y-2">
            {items.map((item, index) => (
              <li
                key={item.id}
                {...drag.rowProps(index)}
                className={`flex cursor-grab items-center gap-3 rounded-lg border bg-white p-2 pl-3 ${drag.overIndex === index && drag.dragIndex !== index ? 'border-brand ring-2 ring-blue-200' : 'border-navy-200'} ${drag.dragIndex === index ? 'opacity-50' : ''}`}
              >
                <span className="w-5 shrink-0 text-sm font-semibold text-navy-500 tabular-nums">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink" title={item.file.name}>
                    {item.file.name}
                  </p>
                  <p className="text-xs text-navy-500 tabular-nums">
                    {item.pages} {item.pages === 1 ? 'page' : 'pages'} · {formatBytes(item.file.size)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button small className="w-9 px-0" aria-label={`Move ${item.file.name} up`} disabled={index === 0} onClick={() => move(index, index - 1)}>
                    ↑
                  </Button>
                  <Button small className="w-9 px-0" aria-label={`Move ${item.file.name} down`} disabled={index === items.length - 1} onClick={() => move(index, index + 1)}>
                    ↓
                  </Button>
                  <Button small variant="danger" className="w-9 px-0" aria-label={`Remove ${item.file.name}`} onClick={() => updateItems((current) => current.filter((i) => i.id !== item.id))}>
                    ✕
                  </Button>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-4 space-y-3">
            {items.some((item) => item.signed) && (
              <Alert tone="warning">
                <p>
                  {items.filter((item) => item.signed).map((item) => `“${item.file.name}”`).join(', ')} {SIGNED_NOTE}
                </p>
              </Alert>
            )}
            <p className="text-xs text-navy-500">{COPY_NOTE}</p>
            {running ? (
              <div className="space-y-3">
                <ProgressBar value={(progress.done / Math.max(1, progress.total)) * 100} label={`Merging file ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`} />
                <Button onClick={() => controller.current?.abort()}>Cancel</Button>
              </div>
            ) : (
              <div className="sticky bottom-0 -mx-4 border-t border-navy-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:p-0">
                <Button variant="primary" className="w-full sm:w-auto" disabled={items.length < 2 || adding} onClick={() => void run()}>
                  Merge {items.length} PDFs
                </Button>
                {items.length < 2 && <p className="mt-2 text-xs text-navy-500">Add at least two PDFs to merge.</p>}
              </div>
            )}
            {runError && <Alert tone="error">{runError}</Alert>}
          </div>
        </Card>
      )}

      {result && (
        <Card title="Preview and download" step={3}>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Facts
                rows={[
                  ['Pages', String(result.pages)],
                  ['File size', `${formatBytes(result.blob.size)} (${result.blob.size.toLocaleString('en')} bytes)`],
                ]}
              />
              <PdfPreview bytes={result.bytes} />
            </div>
            <OutputActions blob={result.blob} suggestedName="merged.pdf" kind="pdf" pages={result.pages} />
          </div>
        </Card>
      )}
    </>
  );
}

function ExtractPanel() {
  const [source, setSource] = useState<{ file: File; bytes: Uint8Array; pages: number; signed: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { doc, error: openError } = usePdfDocument(source?.bytes ?? null, source?.file.name);
  const [rangeText, setRangeText] = useState('');
  const [result, setResult] = useState<{ bytes: Uint8Array; blob: Blob; pages: number; label: string } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const loadId = useRef(0);
  const runId = useRef(0);

  function invalidate() {
    runId.current++;
    setResult(null);
    setRunError(null);
    setWorking(false);
  }

  async function handleFile(file: File) {
    const id = ++loadId.current;
    invalidate();
    setSource(null);
    setLoadError(null);
    setRangeText('');
    setLoading(true);
    try {
      const info = await readPdf(file);
      if (id !== loadId.current) return;
      if (info.pages > LIMITS.pdfPages) {
        setLoadError(`“${file.name}” has ${info.pages} pages. Up to ${LIMITS.pdfPages} pages are supported.`);
        return;
      }
      setSource({ file, ...info });
    } catch (error) {
      if (id === loadId.current) setLoadError(errorMessage(error));
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }

  const parsed = source ? parsePageRanges(rangeText, source.pages) : null;
  const selected = new Set(parsed?.ok ? parsed.pages : []);

  function setRange(text: string) {
    invalidate();
    setRangeText(text);
  }

  function togglePage(page: number) {
    const next = new Set(selected);
    if (next.has(page)) next.delete(page);
    else next.add(page);
    setRange(formatPageRanges(next));
  }

  async function run() {
    if (!source || !parsed?.ok) return;
    invalidate();
    const id = runId.current;
    setWorking(true);
    try {
      const bytes = await extractPages(source.bytes, source.file.name, parsed.pages);
      const pages = await countPdfPages(bytes);
      if (id !== runId.current) return;
      if (pages !== parsed.pages.length) throw new Error(`Extracted ${pages} pages, expected ${parsed.pages.length}`);
      setResult({ bytes, blob: pdfBlob(bytes), pages, label: formatPageRanges(parsed.pages).replace(/[–, ]+/g, (m) => (m.includes(',') ? '_' : '-')) });
    } catch (error) {
      if (id === runId.current) setRunError(errorMessage(error));
    } finally {
      if (id === runId.current) setWorking(false);
    }
  }

  return (
    <>
      <Card title="Upload" step={1}>
        <Dropzone
          accept={PDF_ACCEPT}
          compact={!!source}
          title={source ? 'Replace PDF' : 'Add a PDF'}
          hint={`PDF · up to ${formatBytes(LIMITS.pdfBytes)} and ${LIMITS.pdfPages} pages`}
          onFiles={(files) => void handleFile(files[0])}
        />
        {loading && <p className="mt-3 text-sm text-navy-600" role="status">Reading PDF…</p>}
        {(loadError || openError) && <div className="mt-3"><Alert tone="error">{loadError || openError}</Alert></div>}
        {source && (
          <div className="mt-3">
            <Facts
              rows={[
                ['File', source.file.name],
                ['Pages', String(source.pages)],
                ['Size', formatBytes(source.file.size)],
              ]}
            />
          </div>
        )}
      </Card>

      {source && (
        <Card title="Choose pages" step={2}>
          <div className="space-y-4">
            <Field
              label="Pages to extract"
              htmlFor="page-ranges"
              error={rangeText.trim() && parsed && !parsed.ok ? parsed.error : null}
              hint={`Type ranges such as “1–3, 5, 8”, or tap pages below. This PDF has ${source.pages} ${source.pages === 1 ? 'page' : 'pages'}. Pages are saved in the order you write them.`}
            >
              <input
                id="page-ranges"
                value={rangeText}
                placeholder="e.g. 1-3, 5, 8"
                autoComplete="off"
                onChange={(e) => setRange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void run()}
                className={inputClass}
              />
            </Field>
            {parsed?.ok && (
              <p className="text-sm text-navy-700" role="status">
                {parsed.pages.length} {parsed.pages.length === 1 ? 'page' : 'pages'} selected.
              </p>
            )}

            {doc && (
              <ol className="grid max-h-[28rem] grid-cols-3 gap-3 overflow-y-auto rounded-lg bg-navy-50 p-3 sm:grid-cols-4 lg:grid-cols-6">
                {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((page) => (
                  <li key={page}>
                    <button
                      type="button"
                      aria-pressed={selected.has(page)}
                      aria-label={`Page ${page}${selected.has(page) ? ', selected' : ''}`}
                      onClick={() => togglePage(page)}
                      className={`block w-full rounded-md border-2 bg-white p-1 text-center ${selected.has(page) ? 'border-brand' : 'border-transparent hover:border-navy-300'}`}
                    >
                      <PdfPageCanvas doc={doc} pageNumber={page} label={`Thumbnail of page ${page}`} />
                      <span className={`mt-1 block text-xs font-medium tabular-nums ${selected.has(page) ? 'text-brand' : 'text-navy-600'}`}>
                        {selected.has(page) ? '✓ ' : ''}
                        {page}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}

            {source.signed && (
              <Alert tone="warning">
                <p>“{source.file.name}” {SIGNED_NOTE}</p>
              </Alert>
            )}
            <p className="text-xs text-navy-500">{COPY_NOTE}</p>
            <div className="sticky bottom-0 -mx-4 border-t border-navy-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:p-0">
              <Button variant="primary" className="w-full sm:w-auto" disabled={!parsed?.ok || working} onClick={() => void run()}>
                {working ? 'Extracting…' : 'Extract pages'}
              </Button>
            </div>
            {runError && <Alert tone="error">{runError}</Alert>}
          </div>
        </Card>
      )}

      {source && result && (
        <Card title="Preview and download" step={3}>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Facts
                rows={[
                  ['Pages', String(result.pages)],
                  ['File size', `${formatBytes(result.blob.size)} (${result.blob.size.toLocaleString('en')} bytes)`],
                ]}
              />
              <PdfPreview bytes={result.bytes} />
            </div>
            <OutputActions
              blob={result.blob}
              suggestedName={`${splitName(source.file.name).base}-pages-${result.label}.pdf`}
              kind="pdf"
              pages={result.pages}
            />
          </div>
        </Card>
      )}
    </>
  );
}
