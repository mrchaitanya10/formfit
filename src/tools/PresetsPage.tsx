import { useState } from 'react';
import { ToolPage } from '../components/Layout';
import { Alert, Button, Card, Field, Segmented, inputClass } from '../components/ui';
import { parseWholeNumber } from '../lib/format';
import { LIMITS } from '../lib/limits';
import { type DocType, EXAMPLE_PRESETS, type Preset, describePreset } from '../lib/presets';
import { href } from '../state/router';
import { usePresets } from '../state/usePresets';

const TYPE_LABEL: Record<DocType, string> = { photo: 'Photo', signature: 'Signature', pdf: 'PDF' };

function presetLink(preset: Preset): string {
  return href(preset.docType === 'pdf' ? 'compress' : 'photo', { preset: preset.id });
}

function PresetRow({ preset, example, onDelete }: { preset: Preset; example?: boolean; onDelete?: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-navy-200 bg-white p-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
          <span className="break-words">{preset.name}</span>
          <span className="rounded-full bg-navy-100 px-2 py-0.5 text-xs font-medium text-navy-700">{TYPE_LABEL[preset.docType]}</span>
          {example && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Example</span>}
        </p>
        <p className="mt-0.5 text-sm text-navy-600 tabular-nums">{describePreset(preset)}</p>
      </div>
      <div className="flex gap-2">
        <a
          href={presetLink(preset)}
          className="inline-flex min-h-9 items-center rounded-lg border border-navy-300 bg-white px-3 text-sm font-medium text-ink hover:bg-navy-100"
          aria-label={`Use preset ${preset.name}`}
        >
          Use
        </a>
        {onDelete && (
          <Button small variant="danger" aria-label={`Delete preset ${preset.name}`} onClick={onDelete}>
            Delete
          </Button>
        )}
      </div>
    </li>
  );
}

export function PresetsPage() {
  const { presets, addPreset, removePreset } = usePresets();
  const [name, setName] = useState('');
  const [docType, setDocType] = useState<DocType>('photo');
  const [widthText, setWidthText] = useState('600');
  const [heightText, setHeightText] = useState('600');
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg');
  const [maxKbText, setMaxKbText] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const isPdf = docType === 'pdf';
  const width = parseWholeNumber(widthText);
  const height = parseWholeNumber(heightText);
  const sideOk = (v: number | null) => v !== null && v >= LIMITS.outputSideMin && v <= LIMITS.outputSide;
  const maxKb = maxKbText.trim() === '' ? null : parseWholeNumber(maxKbText);
  const maxKbOk = maxKbText.trim() === '' || (maxKb !== null && maxKb >= 1 && maxKb <= LIMITS.maxTargetKb);
  const valid = name.trim() !== '' && maxKbOk && (isPdf || (sideOk(width) && sideOk(height)));

  function save() {
    if (!valid) return;
    const ok = addPreset({
      name: name.trim().slice(0, 60),
      docType,
      width: isPdf ? null : width,
      height: isPdf ? null : height,
      format: isPdf ? 'pdf' : format,
      maxKb,
    });
    setMessage(
      ok
        ? { ok: true, text: `Saved “${name.trim()}”.` }
        : { ok: false, text: 'Your browser blocked saving. Presets need local storage to be allowed.' },
    );
    if (ok) setName('');
  }

  return (
    <ToolPage
      title="Requirement presets"
      intro="Save the requirements from a form once and reuse them. Only these settings are stored in this browser — never your files."
    >
      <Card title="Your presets">
        {presets.length === 0 ? (
          <p className="text-sm text-navy-500">No saved presets yet. Create one below, or save your settings from inside a tool.</p>
        ) : (
          <ul className="space-y-2">
            {presets.map((preset) => (
              <PresetRow key={preset.id} preset={preset} onDelete={() => removePreset(preset.id)} />
            ))}
          </ul>
        )}
      </Card>

      <Card title="New preset">
        <div className="space-y-4">
          <Field label="Name" htmlFor="preset-name">
            <input id="preset-name" value={name} maxLength={60} placeholder="e.g. College admission signature" onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <div>
            <p className="mb-1 text-sm font-medium text-ink">Document type</p>
            <Segmented
              label="Document type"
              value={docType}
              onChange={(value) => {
                setDocType(value);
                if (value === 'signature') {
                  setWidthText('600');
                  setHeightText('200');
                }
              }}
              options={[
                { value: 'photo', label: 'Photo' },
                { value: 'signature', label: 'Signature' },
                { value: 'pdf', label: 'PDF' },
              ]}
            />
          </div>
          {!isPdf && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
                <Field label="Width (px)" htmlFor="preset-width" error={sideOk(width) ? null : `Use ${LIMITS.outputSideMin}–${LIMITS.outputSide}.`}>
                  <input id="preset-width" inputMode="numeric" value={widthText} onChange={(e) => setWidthText(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Height (px)" htmlFor="preset-height" error={sideOk(height) ? null : `Use ${LIMITS.outputSideMin}–${LIMITS.outputSide}.`}>
                  <input id="preset-height" inputMode="numeric" value={heightText} onChange={(e) => setHeightText(e.target.value)} className={inputClass} />
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
            </>
          )}
          <div className="sm:max-w-sm">
            <Field
              label="Maximum file size (KB) — optional"
              htmlFor="preset-max-kb"
              error={maxKbOk ? null : `Enter a whole number from 1 to ${LIMITS.maxTargetKb.toLocaleString('en')}, or leave empty.`}
              hint="1 KB = 1,000 bytes."
            >
              <input id="preset-max-kb" inputMode="numeric" value={maxKbText} onChange={(e) => setMaxKbText(e.target.value)} className={inputClass} />
            </Field>
          </div>
          <Button variant="primary" disabled={!valid} onClick={save}>
            Save preset
          </Button>
          {message && <Alert tone={message.ok ? 'success' : 'error'}>{message.text}</Alert>}
        </div>
      </Card>

      <Card title="Examples">
        <p className="mb-3 text-sm text-navy-600">
          These are generic illustrations, not the rules of any real organisation. Always copy the exact numbers from your own application form.
        </p>
        <ul className="space-y-2">
          {EXAMPLE_PRESETS.map((preset) => (
            <PresetRow key={preset.id} preset={preset} example />
          ))}
        </ul>
      </Card>
    </ToolPage>
  );
}
