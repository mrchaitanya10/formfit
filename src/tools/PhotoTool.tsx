import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CropEditor } from '../components/CropEditor';
import { Dropzone } from '../components/Dropzone';
import { ToolPage } from '../components/Layout';
import { OutputActions } from '../components/OutputActions';
import { PresetPicker } from '../components/PresetPicker';
import { Alert, Button, Card, CheckLine, Checkbox, Facts, Field, Segmented, inputClass } from '../components/ui';
import { IMAGE_ACCEPT, errorMessage } from '../lib/files';
import { formatBytes, kbToBytes, parseWholeNumber, splitName } from '../lib/format';
import {
  type CropState,
  DEFAULT_CROP,
  type EncodeResult,
  type ImageCheck,
  type ImageFormat,
  type LoadedImage,
  MIN_JPEG_QUALITY,
  clampCrop,
  encodeWithLimit,
  loadImage,
  releaseCanvas,
  renderOutputCanvas,
  verifyImageBlob,
} from '../lib/image';
import { LIMITS } from '../lib/limits';
import type { Preset } from '../lib/presets';
import { useObjectUrl } from '../state/useObjectUrl';

type Mode = 'photo' | 'signature';

const MODE_DEFAULTS: Record<Mode, { width: string; height: string }> = {
  photo: { width: '600', height: '600' },
  signature: { width: '600', height: '200' },
};

interface Output {
  encode: EncodeResult;
  check: ImageCheck;
  width: number;
  height: number;
  format: ImageFormat;
  maxBytes: number | null;
}

function sideError(value: number | null): string | null {
  if (value === null) return 'Enter a whole number of pixels.';
  if (value < LIMITS.outputSideMin || value > LIMITS.outputSide) {
    return `Use ${LIMITS.outputSideMin}–${LIMITS.outputSide} px.`;
  }
  return null;
}

export function PhotoTool({ initialPreset }: { initialPreset?: Preset }) {
  // A preset passed in from the presets page sets the starting values.
  const start = initialPreset && initialPreset.docType !== 'pdf' && initialPreset.format !== 'pdf' ? initialPreset : null;
  const [mode, setMode] = useState<Mode>(start?.docType === 'signature' ? 'signature' : 'photo');
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [widthText, setWidthText] = useState(start?.width ? String(start.width) : MODE_DEFAULTS[mode].width);
  const [heightText, setHeightText] = useState(start?.height ? String(start.height) : MODE_DEFAULTS[mode].height);
  const [format, setFormat] = useState<ImageFormat>(start?.format === 'png' ? 'png' : 'jpeg');
  const [maxKbText, setMaxKbText] = useState(start?.maxKb ? String(start.maxKb) : '');
  const [quality, setQuality] = useState(0.92);
  const [bgColor, setBgColor] = useState('#ffffff');
  const [fillPng, setFillPng] = useState(mode === 'signature');
  const [crop, setCrop] = useState<CropState>(DEFAULT_CROP);

  const [output, setOutput] = useState<Output | null>(null);
  const [working, setWorking] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const runId = useRef(0);
  const loadId = useRef(0);

  const applyPreset = useCallback((preset: Preset) => {
    if (preset.docType === 'pdf' || !preset.width || !preset.height || preset.format === 'pdf') return;
    setMode(preset.docType);
    setWidthText(String(preset.width));
    setHeightText(String(preset.height));
    setFormat(preset.format);
    setMaxKbText(preset.maxKb ? String(preset.maxKb) : '');
    if (preset.docType === 'signature') setFillPng(true);
  }, []);

  // Release the decoded image when it is replaced or the tool is closed.
  useEffect(() => () => image?.bitmap.close(), [image]);

  async function handleFile(file: File) {
    const id = ++loadId.current;
    setLoadError(null);
    setLoading(true);
    try {
      const loaded = await loadImage(file);
      if (id !== loadId.current) {
        loaded.bitmap.close();
        return;
      }
      setImage(loaded);
      setCrop(DEFAULT_CROP);
      setOutput(null);
    } catch (error) {
      if (id === loadId.current) setLoadError(errorMessage(error));
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setWidthText(MODE_DEFAULTS[next].width);
    setHeightText(MODE_DEFAULTS[next].height);
    setFillPng(next === 'signature');
    if (next === 'signature') setBgColor('#ffffff');
  }

  const width = parseWholeNumber(widthText);
  const height = parseWholeNumber(heightText);
  const widthError = sideError(width);
  const heightError = sideError(height);
  const maxKb = maxKbText.trim() === '' ? null : parseWholeNumber(maxKbText);
  const maxKbError =
    maxKbText.trim() !== '' && (maxKb === null || maxKb < 1 || maxKb > LIMITS.maxTargetKb)
      ? `Enter a whole number from 1 to ${LIMITS.maxTargetKb.toLocaleString('en')}, or leave empty.`
      : null;
  const settingsValid = !widthError && !heightError && !maxKbError;
  const outW = widthError ? 0 : (width as number);
  const outH = heightError ? 0 : (height as number);
  const maxBytes = maxKb && !maxKbError ? kbToBytes(maxKb) : null;

  // JPEG cannot store transparency, so it always gets a background. PNG gets one only when asked.
  const background = format === 'jpeg' || fillPng ? (mode === 'signature' ? '#ffffff' : bgColor) : null;

  const shownCrop = useMemo(
    () => (image && settingsValid ? clampCrop(crop, image.width, image.height, outW, outH) : crop),
    [image, settingsValid, crop, outW, outH],
  );

  // Re-export shortly after any change. Results from older runs are discarded.
  useEffect(() => {
    if (!image || !settingsValid) {
      runId.current++;
      setOutput(null);
      setWorking(false);
      return;
    }
    const id = ++runId.current;
    const isStale = () => id !== runId.current;
    setWorking(true);
    setExportError(null);
    const timer = setTimeout(async () => {
      let canvas: HTMLCanvasElement | null = null;
      try {
        canvas = renderOutputCanvas(image, outW, outH, shownCrop, background);
        const encode = await encodeWithLimit(canvas, format, maxBytes, quality, isStale);
        if (isStale()) return;
        // Measure the real file before claiming anything about it.
        const check = await verifyImageBlob(encode.blob, { format, width: outW, height: outH, maxBytes });
        if (isStale()) return;
        setOutput({ encode, check, width: outW, height: outH, format, maxBytes });
      } catch (error) {
        if (!isStale()) {
          setOutput(null);
          setExportError(errorMessage(error));
        }
      } finally {
        if (canvas) releaseCanvas(canvas);
        if (!isStale()) setWorking(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [image, settingsValid, outW, outH, shownCrop, background, format, maxBytes, quality]);

  const outputUrl = useObjectUrl(output?.encode.blob ?? null);
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const suggestedName = image ? `${splitName(image.file.name).base}-${mode}-${outW}x${outH}.${ext}` : `${mode}.${ext}`;

  return (
    <ToolPage
      title="Photo and signature"
      intro="Crop to exact pixel dimensions, choose JPEG or PNG, and optionally keep the file under a size limit."
    >
      <Segmented
        label="Document type"
        value={mode}
        onChange={switchMode}
        options={[
          { value: 'photo', label: 'Photo' },
          { value: 'signature', label: 'Signature' },
        ]}
      />

      <Card title="Upload" step={1}>
        <Dropzone
          accept={IMAGE_ACCEPT}
          compact={!!image}
          title={image ? 'Replace image' : mode === 'photo' ? 'Add your photo' : 'Add a photo or scan of your signature'}
          hint={`JPEG, PNG or WebP · up to ${formatBytes(LIMITS.imageBytes)} and ${LIMITS.imagePixels / 1_000_000} megapixels`}
          onFiles={(files) => void handleFile(files[0])}
        />
        {loading && <p className="mt-3 text-sm text-navy-600" role="status">Opening image…</p>}
        {loadError && <div className="mt-3"><Alert tone="error">{loadError}</Alert></div>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Requirements" step={2}>
          <div className="space-y-4">
            <PresetPicker
              docType={mode}
              onApply={applyPreset}
              current={settingsValid ? { docType: mode, width: outW, height: outH, format, maxKb: maxKb ?? null } : null}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Width (px)" htmlFor="out-width" error={widthError}>
                <input id="out-width" inputMode="numeric" value={widthText} onChange={(e) => setWidthText(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Height (px)" htmlFor="out-height" error={heightError}>
                <input id="out-height" inputMode="numeric" value={heightText} onChange={(e) => setHeightText(e.target.value)} className={inputClass} />
              </Field>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-ink">Format</p>
              <Segmented
                label="Output format"
                value={format}
                onChange={setFormat}
                options={[
                  { value: 'jpeg', label: 'JPEG' },
                  { value: 'png', label: 'PNG' },
                ]}
              />
            </div>
            <Field
              label="Maximum file size (KB) — optional"
              htmlFor="max-kb"
              error={maxKbError}
              hint="1 KB = 1,000 bytes. Leave empty for no limit."
            >
              <input id="max-kb" inputMode="numeric" placeholder="e.g. 100" value={maxKbText} onChange={(e) => setMaxKbText(e.target.value)} className={inputClass} />
            </Field>
            {format === 'jpeg' && (
              <label className="block text-sm font-medium text-ink">
                {maxBytes ? 'Highest JPEG quality to try' : 'JPEG quality'}{' '}
                <span className="font-normal text-navy-500 tabular-nums">{Math.round(quality * 100)}</span>
                <input
                  type="range"
                  min={0.3}
                  max={1}
                  step={0.01}
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                  className="mt-1 block h-8 w-full accent-brand"
                />
              </label>
            )}

            <div>
              <p className="text-sm font-medium text-ink">Background</p>
              {mode === 'signature' ? (
                <Checkbox id="white-bg" checked={format === 'jpeg' || fillPng} disabled={format === 'jpeg'} onChange={setFillPng}>
                  White background
                  {format === 'jpeg' && <span className="block text-xs text-navy-500">Always on for JPEG, which cannot be transparent.</span>}
                </Checkbox>
              ) : (
                <>
                  {format === 'png' && (
                    <Checkbox id="fill-png" checked={fillPng} onChange={setFillPng}>
                      Fill transparent and empty areas with a colour
                    </Checkbox>
                  )}
                  {background && (
                    <label className="mt-1 flex min-h-11 items-center gap-3 text-sm text-ink">
                      <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-navy-300 bg-white" />
                      Background colour <span className="text-navy-500 uppercase tabular-nums">{bgColor}</span>
                    </label>
                  )}
                </>
              )}
              {image?.hasAlpha && format === 'jpeg' && (
                <p className="mt-1 text-xs text-navy-600">
                  This image has transparent areas. JPEG cannot keep them, so they are filled with the background colour shown in the preview.
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card title="Crop" step={3}>
          {image && settingsValid ? (
            <CropEditor image={image} outW={outW} outH={outH} crop={shownCrop} background={background} onChange={setCrop} />
          ) : (
            <p className="text-sm text-navy-500">
              {image ? 'Fix the highlighted requirements to continue.' : 'Upload an image to choose the crop area.'}
            </p>
          )}
        </Card>
      </div>

      {image && (
        <Card title="Preview and download" step={4}>
          {exportError && <Alert tone="error">{exportError}</Alert>}
          {!output && working && <p className="text-sm text-navy-600" role="status">Preparing your file…</p>}
          {output && (
            <div className={`space-y-4 transition-opacity ${working ? 'opacity-60' : ''}`} aria-busy={working}>
              <ResultSummary
                output={output}
                onRaiseLimit={(kb) => setMaxKbText(String(kb))}
                onResize={(w, h) => {
                  setWidthText(String(w));
                  setHeightText(String(h));
                }}
                onUseJpeg={() => setFormat('jpeg')}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-sm font-medium text-ink">Exported file, exactly as it will download</p>
                  <div className="flex justify-center rounded-lg bg-navy-100 p-3">
                    {outputUrl && (
                      <img
                        src={outputUrl}
                        alt="Preview of the exported file"
                        className={`max-h-80 max-w-full object-contain ring-1 ring-navy-300 ${background ? '' : 'checkerboard'}`}
                      />
                    )}
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy-500">Original</p>
                    <Facts
                      rows={[
                        ['Dimensions', `${image.width} × ${image.height} px`],
                        ['File size', formatBytes(image.file.size)],
                        ['Format', image.kind.toUpperCase()],
                      ]}
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy-500">Output (measured)</p>
                    <Facts
                      rows={[
                        ['Dimensions', `${output.check.actualWidth} × ${output.check.actualHeight} px`],
                        ['File size', `${formatBytes(output.check.actualBytes)} (${output.check.actualBytes.toLocaleString('en')} bytes)`],
                        ['Format', output.check.actualKind.toUpperCase()],
                        ...(output.encode.quality !== null
                          ? ([['JPEG quality', String(Math.round(output.encode.quality * 100))]] as [string, string][])
                          : []),
                      ]}
                    />
                  </div>
                </div>
              </div>
              <OutputActions
                blob={output.encode.blob}
                suggestedName={suggestedName}
                kind={output.format}
                width={output.check.actualWidth}
                height={output.check.actualHeight}
              />
            </div>
          )}
        </Card>
      )}
    </ToolPage>
  );
}

/** States plainly whether the measured file meets each requirement, and what to change if not. */
function ResultSummary({
  output,
  onRaiseLimit,
  onResize,
  onUseJpeg,
}: {
  output: Output;
  onRaiseLimit: (kb: number) => void;
  onResize: (width: number, height: number) => void;
  onUseJpeg: () => void;
}) {
  const { check, encode, maxBytes } = output;
  const checks = (
    <ul className="space-y-1">
      <CheckLine ok={check.dimensionsOk}>
        Dimensions are {check.actualWidth} × {check.actualHeight} px (requested {output.width} × {output.height})
      </CheckLine>
      <CheckLine ok={check.formatOk}>File type is {check.actualKind.toUpperCase()}</CheckLine>
      {maxBytes !== null && (
        <CheckLine ok={check.sizeOk === true}>
          File size is {formatBytes(check.actualBytes)} (limit {formatBytes(maxBytes)})
        </CheckLine>
      )}
    </ul>
  );

  if (check.allOk) {
    const lowQuality = encode.quality !== null && encode.quality < 0.4;
    return (
      <div className="space-y-3">
        <Alert tone="success" title={maxBytes !== null ? 'Meets the requirements you entered' : 'Ready'}>
          {checks}
        </Alert>
        {lowQuality && (
          <Alert tone="warning">
            To fit the limit, JPEG quality had to drop to {Math.round((encode.quality ?? 0) * 100)}. Check the preview for blur or blockiness before
            using this file.
          </Alert>
        )}
      </div>
    );
  }

  if (check.sizeOk === false && maxBytes !== null) {
    // Suggest a size that should fit, keeping the same shape. This is an estimate, not a promise.
    const shrink = Math.sqrt(maxBytes / check.actualBytes) * 0.9;
    const smallerW = Math.max(LIMITS.outputSideMin, Math.floor(output.width * shrink));
    const smallerH = Math.max(LIMITS.outputSideMin, Math.round(smallerW * (output.height / output.width)));
    const neededKb = Math.ceil(check.actualBytes / 1000);
    return (
      <Alert tone="warning" title={`The ${formatBytes(maxBytes)} limit could not be reached`}>
        {output.format === 'jpeg' ? (
          <p>
            Even at the lowest JPEG quality ({Math.round(MIN_JPEG_QUALITY * 100)}), a {output.width} × {output.height} px version of this image is{' '}
            {formatBytes(check.actualBytes)}. FormFit keeps the pixel dimensions you asked for, so this target is not achievable with the current
            settings. The file below is the smallest possible and is over the limit.
          </p>
        ) : (
          <p>
            PNG is lossless, so its size cannot be tuned: this {output.width} × {output.height} px image is {formatBytes(check.actualBytes)}. The file
            below is over the limit.
          </p>
        )}
        {checks}
        <p className="font-medium">What you can change:</p>
        <div className="flex flex-wrap gap-2">
          {output.format === 'png' && (
            <Button small onClick={onUseJpeg}>
              Switch to JPEG
            </Button>
          )}
          <Button small onClick={() => onRaiseLimit(neededKb)}>
            Raise limit to {neededKb} KB
          </Button>
          {smallerW < output.width && (
            <Button small onClick={() => onResize(smallerW, smallerH)}>
              Try {smallerW} × {smallerH} px
            </Button>
          )}
        </div>
        <p className="text-xs">Only change dimensions or the limit if your form allows it. A smaller size is an estimate and may still need adjusting.</p>
      </Alert>
    );
  }

  return (
    <Alert tone="error" title="The exported file does not match what was requested">
      {checks}
      <p>This is unexpected. Try different dimensions, or reload the page and try again.</p>
    </Alert>
  );
}
