import { useEffect, useRef, useState } from 'react';
import { Dropzone } from '../components/Dropzone';
import { ToolPage } from '../components/Layout';
import { OutputActions } from '../components/OutputActions';
import { PdfPreview, usePdfDocument } from '../components/PdfPreview';
import { PresetPicker } from '../components/PresetPicker';
import { Alert, Button, Card, CheckLine, Checkbox, Facts, Field, ProgressBar, inputClass } from '../components/ui';
import { PDF_ACCEPT, downloadBlob, errorMessage, isAbortError, pdfBlob, validatePdfFile } from '../lib/files';
import { formatBytes, kbToBytes, parseWholeNumber, percentReduction, splitName } from '../lib/format';
import { LIMITS } from '../lib/limits';
import { countPdfPages } from '../lib/pdfBuild';
import { type CompressProgress, type CompressResult, MAX_COMPRESS_ATTEMPTS, compressPdfAsImages } from '../lib/pdfCompress';
import { pdfLooksSigned } from '../lib/pdfjs';
import type { Preset } from '../lib/presets';
import { useKit } from '../state/kit';

const DPI_OPTIONS = [
  { value: 200, label: '200 dpi — sharpest, largest' },
  { value: 150, label: '150 dpi — good for most documents' },
  { value: 110, label: '110 dpi — smaller' },
  { value: 72, label: '72 dpi — smallest, small text may blur' },
];

interface Source {
  file: File;
  bytes: Uint8Array;
}

interface Outcome {
  result: CompressResult;
  blob: Blob;
  /** Pages counted by re-reading the finished file. */
  verifiedPages: number;
  maxBytes: number | null;
}

export function PdfCompressTool({ initialPreset }: { initialPreset?: Preset }) {
  const kit = useKit();
  const [source, setSource] = useState<Source | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { doc, error: openError } = usePdfDocument(source?.bytes ?? null, source?.file.name);
  const [signed, setSigned] = useState(false);
  const [acceptSigned, setAcceptSigned] = useState(false);

  const [maxKbText, setMaxKbText] = useState(initialPreset?.maxKb ? String(initialPreset.maxKb) : '500');
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(0.75);
  const [grayscale, setGrayscale] = useState(false);

  const [progress, setProgress] = useState<CompressProgress | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [kitNote, setKitNote] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const loadId = useRef(0);

  // Stop any running job when the tool is closed.
  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    setSigned(false);
    setAcceptSigned(false);
    if (!doc || !source) return;
    let cancelled = false;
    void pdfLooksSigned(doc, source.bytes).then((value) => !cancelled && setSigned(value));
    return () => {
      cancelled = true;
    };
  }, [doc, source]);

  function reset() {
    controller.current?.abort();
    setProgress(null);
    setOutcome(null);
    setRunError(null);
    setKitNote(null);
  }

  async function handleFile(file: File) {
    const id = ++loadId.current;
    reset();
    setLoadError(null);
    setSource(null);
    try {
      await validatePdfFile(file);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (id === loadId.current) setSource({ file, bytes });
    } catch (error) {
      if (id === loadId.current) setLoadError(errorMessage(error));
    }
  }

  /** Changing any setting makes an existing result outdated, so it is discarded. */
  function change<T>(setter: (value: T) => void) {
    return (value: T) => {
      reset();
      setter(value);
    };
  }

  const maxKb = maxKbText.trim() === '' ? null : parseWholeNumber(maxKbText);
  const maxKbError =
    maxKbText.trim() !== '' && (maxKb === null || maxKb < 1 || maxKb > LIMITS.maxTargetKb)
      ? `Enter a whole number from 1 to ${LIMITS.maxTargetKb.toLocaleString('en')}, or leave empty.`
      : null;
  const maxBytes = maxKb && !maxKbError ? kbToBytes(maxKb) : null;
  const tooManyPages = !!doc && doc.numPages > LIMITS.compressPages;
  const running = progress !== null;
  const canRun = !!doc && !tooManyPages && !maxKbError && !running && (!signed || acceptSigned);

  async function run() {
    if (!doc || !source) return;
    reset();
    const abort = new AbortController();
    controller.current = abort;
    setProgress({ attempt: 1, maxAttempts: maxBytes === null ? 1 : MAX_COMPRESS_ATTEMPTS, page: 0, pageCount: doc.numPages });
    try {
      const result = await compressPdfAsImages(doc, { maxBytes, dpi, quality, grayscale }, abort.signal, setProgress);
      // Re-read the finished file to confirm it is a PDF with every page present.
      const verifiedPages = await countPdfPages(result.bytes);
      if (abort.signal.aborted) return;
      setOutcome({ result, blob: pdfBlob(result.bytes), verifiedPages, maxBytes });
    } catch (error) {
      if (!isAbortError(error) && !abort.signal.aborted) setRunError(errorMessage(error));
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setProgress(null);
      }
    }
  }

  const alreadySmall = source && maxBytes !== null && source.file.size <= maxBytes;
  const baseName = source ? splitName(source.file.name).base : 'document';

  return (
    <ToolPage title="Compress PDF" intro="Make a PDF smaller so it fits an upload limit. Check the preview before you use the result.">
      <Card title="Upload" step={1}>
        <Dropzone
          accept={PDF_ACCEPT}
          compact={!!source}
          title={source ? 'Replace PDF' : 'Add a PDF'}
          hint={`PDF · up to ${formatBytes(LIMITS.pdfBytes)} and ${LIMITS.compressPages} pages`}
          onFiles={(files) => void handleFile(files[0])}
        />
        {(loadError || openError) && <div className="mt-3"><Alert tone="error">{loadError || openError}</Alert></div>}
        {source && !doc && !openError && <p className="mt-3 text-sm text-navy-600" role="status">Opening PDF…</p>}
        {source && doc && (
          <div className="mt-3">
            <Facts
              rows={[
                ['File', source.file.name],
                ['Original size', formatBytes(source.file.size)],
                ['Pages', String(doc.numPages)],
              ]}
            />
          </div>
        )}
        {tooManyPages && (
          <div className="mt-3">
            <Alert tone="error">
              This PDF has {doc?.numPages} pages. Image-based compression handles up to {LIMITS.compressPages} pages to stay within browser memory.
              Use “Merge and extract” to split it into parts first.
            </Alert>
          </div>
        )}
      </Card>

      {source && doc && !tooManyPages && (
        <Card title="Settings" step={2}>
          <div className="space-y-4">
            <Alert tone="info" title="Smaller PDF — converts pages to images">
              <p>
                Every page is redrawn as a picture and a new PDF is built from those pictures. Page order, orientation and page size stay the same,
                but the new file can lose selectable and searchable text, links, form fields, bookmarks and other interactive features. Your
                original file is not changed.
              </p>
            </Alert>

            {signed && (
              <Alert tone="warning" title="This PDF appears to contain a digital signature">
                <p>Rewriting the file removes the signature, and the new PDF will no longer verify as signed. Keep the original for any place that needs the signed version.</p>
                <Checkbox id="accept-signed" checked={acceptSigned} onChange={setAcceptSigned}>
                  I understand the new file will not be digitally signed
                </Checkbox>
              </Alert>
            )}

            <PresetPicker
              docType="pdf"
              onApply={(preset) => change(setMaxKbText)(preset.maxKb ? String(preset.maxKb) : '')}
              current={maxKbError ? null : { docType: 'pdf', width: null, height: null, format: 'pdf', maxKb: maxKb ?? null }}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Maximum file size (KB)" htmlFor="pdf-max-kb" error={maxKbError} hint="1 KB = 1,000 bytes. Leave empty to compress once at the settings below.">
                <input id="pdf-max-kb" inputMode="numeric" value={maxKbText} onChange={(e) => change(setMaxKbText)(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Starting resolution" htmlFor="pdf-dpi">
                <select id="pdf-dpi" value={dpi} onChange={(e) => change(setDpi)(Number(e.target.value))} className={inputClass}>
                  {DPI_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="block text-sm font-medium text-ink">
              Starting image quality <span className="font-normal text-navy-500 tabular-nums">{Math.round(quality * 100)}</span>
              <input
                type="range"
                min={0.3}
                max={0.95}
                step={0.05}
                value={quality}
                onChange={(e) => change(setQuality)(Number(e.target.value))}
                className="mt-1 block h-8 w-full accent-brand"
              />
            </label>
            <Checkbox id="pdf-gray" checked={grayscale} onChange={change(setGrayscale)}>
              Convert to greyscale <span className="text-navy-500">(often smaller for scans and text)</span>
            </Checkbox>
            <p className="text-xs text-navy-500">
              With a size limit, FormFit starts at these settings and lowers resolution and quality step by step, for at most {MAX_COMPRESS_ATTEMPTS}{' '}
              attempts. Some limits cannot be reached while keeping pages readable.
            </p>

            {alreadySmall && !outcome && (
              <Alert tone="info">
                This PDF is already {formatBytes(source.file.size)}, which is under your {formatBytes(maxBytes ?? 0)} limit. You can use it as it is —
                compressing would only remove text and links.
              </Alert>
            )}

            {running ? (
              <div className="space-y-3">
                <ProgressBar
                  value={progress.pageCount ? ((progress.page - 1) / progress.pageCount) * 100 : undefined}
                  label={`${progress.maxAttempts > 1 ? `Attempt ${progress.attempt} of up to ${progress.maxAttempts} · ` : ''}page ${Math.max(1, progress.page)} of ${progress.pageCount}`}
                />
                <Button onClick={() => controller.current?.abort()}>Cancel</Button>
              </div>
            ) : (
              <div className="sticky bottom-0 -mx-4 border-t border-navy-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:p-0">
                <Button variant="primary" className="w-full sm:w-auto" disabled={!canRun} onClick={() => void run()}>
                  Compress PDF
                </Button>
              </div>
            )}
            {runError && <Alert tone="error">{runError}</Alert>}
          </div>
        </Card>
      )}

      {source && outcome && (
        <Card title="Preview and download" step={3}>
          <CompressOutcome
            outcome={outcome}
            originalBytes={source.file.size}
            originalPages={doc?.numPages ?? outcome.result.pageCount}
            baseName={baseName}
            kitNote={kitNote}
            onDownloadOriginal={() => downloadBlob(source.file, source.file.name)}
            onAddOriginal={() => {
              const error = kit.add({ name: source.file.name, blob: source.file, kind: 'pdf', pages: doc?.numPages });
              setKitNote(error ?? 'Added the original PDF to your kit.');
            }}
          />
        </Card>
      )}
    </ToolPage>
  );
}

function CompressOutcome({
  outcome,
  originalBytes,
  originalPages,
  baseName,
  kitNote,
  onDownloadOriginal,
  onAddOriginal,
}: {
  outcome: Outcome;
  originalBytes: number;
  originalPages: number;
  baseName: string;
  kitNote: string | null;
  onDownloadOriginal: () => void;
  onAddOriginal: () => void;
}) {
  const { result, blob, verifiedPages, maxBytes } = outcome;
  const outputBytes = blob.size;
  const larger = outputBytes >= originalBytes;
  const pagesOk = verifiedPages === originalPages;
  const sizeOk = maxBytes === null ? null : outputBytes <= maxBytes;
  const last = result.attempts[result.attempts.length - 1];
  const used = result.attempts.find((a) => a.bytes === outputBytes) ?? last;
  const reduction = percentReduction(originalBytes, outputBytes);

  return (
    <div className="space-y-4">
      {larger ? (
        <Alert tone="warning" title="The image-based version is not smaller than your original">
          <p>
            The result is {formatBytes(outputBytes)}, and the original is {formatBytes(originalBytes)}. This is common for PDFs that are mostly
            text. Your original is the better file to use.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button small variant="primary" onClick={onDownloadOriginal}>
              Download original
            </Button>
            <Button small onClick={onAddOriginal}>
              Add original to kit
            </Button>
          </div>
          {kitNote && <p role="status">{kitNote}</p>}
        </Alert>
      ) : sizeOk === false ? (
        <Alert tone="warning" title={`Target not met: the smallest result is ${formatBytes(outputBytes)}`}>
          <p>
            After {result.attempts.length} {result.attempts.length === 1 ? 'attempt' : 'attempts'}, the file is still over your{' '}
            {formatBytes(maxBytes ?? 0)} limit. You can try a lower starting resolution or quality, turn on greyscale, or split the PDF with “Merge
            and extract”. You can still download this smaller version below.
          </p>
        </Alert>
      ) : (
        <Alert tone="success" title={sizeOk ? 'Under your size limit' : 'Compressed'}>
          <p>Look through the preview to make sure the text is still readable before you use this file.</p>
        </Alert>
      )}

      <ul className="space-y-1">
        <CheckLine ok={pagesOk}>
          {verifiedPages} of {originalPages} pages present in the new file
        </CheckLine>
        {maxBytes !== null && (
          <CheckLine ok={sizeOk === true}>
            File size is {formatBytes(outputBytes)} (limit {formatBytes(maxBytes)})
          </CheckLine>
        )}
      </ul>

      <div className="grid gap-4 md:grid-cols-2">
        <Facts
          rows={[
            ['Original size', formatBytes(originalBytes)],
            ['Output size', `${formatBytes(outputBytes)} (${outputBytes.toLocaleString('en')} bytes)`],
            ['Change', reduction >= 0 ? `${reduction.toFixed(1)}% smaller` : `${Math.abs(reduction).toFixed(1)}% larger`],
            ['Attempts used', `${result.attempts.length} of ${maxBytes === null ? 1 : MAX_COMPRESS_ATTEMPTS}`],
            ['Final settings', `${used.dpi} dpi, quality ${Math.round(used.quality * 100)}`],
          ]}
        />
        <PdfPreview bytes={result.bytes} />
      </div>

      {!larger && <OutputActions blob={blob} suggestedName={`${baseName}-compressed.pdf`} kind="pdf" pages={verifiedPages} />}
    </div>
  );
}
