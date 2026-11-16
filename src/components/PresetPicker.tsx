import { useId, useState } from 'react';
import { type DocType, EXAMPLE_PRESETS, type Preset, describePreset, isExamplePreset } from '../lib/presets';
import { usePresets } from '../state/usePresets';
import { Button, inputClass } from './ui';

interface Props {
  docType: DocType;
  onApply: (preset: Preset) => void;
  /** Current valid settings, or null when they cannot be saved yet. */
  current: Omit<Preset, 'id' | 'name'> | null;
}

/** Apply a saved or example preset, or save the current settings under a name. */
export function PresetPicker({ docType, onApply, current }: Props) {
  const { presets, addPreset } = usePresets();
  const selectId = useId();
  const nameId = useId();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const options = [...presets, ...EXAMPLE_PRESETS].filter((preset) => preset.docType === docType);

  function save() {
    if (!current || !name.trim()) return;
    const ok = addPreset({ ...current, name: name.trim().slice(0, 60) });
    setMessage(ok ? `Saved “${name.trim()}”.` : 'Your browser blocked saving. Presets need local storage to be allowed.');
    if (ok) {
      setSaving(false);
      setName('');
    }
  }

  return (
    <div className="rounded-lg bg-navy-50 p-3">
      <label htmlFor={selectId} className="mb-1 block text-sm font-medium text-ink">
        Preset
      </label>
      <div className="flex gap-2">
        <select
          id={selectId}
          value=""
          onChange={(event) => {
            const preset = options.find((p) => p.id === event.target.value);
            if (preset) onApply(preset);
          }}
          className={inputClass}
        >
          <option value="">Apply a preset…</option>
          {options.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {isExamplePreset(preset) ? 'Example: ' : ''}
              {preset.name} — {describePreset(preset)}
            </option>
          ))}
        </select>
        <Button className="shrink-0" disabled={!current} onClick={() => setSaving(!saving)}>
          Save…
        </Button>
      </div>
      <p className="mt-1 text-xs text-navy-500">Examples are generic. Always use the numbers from your own application form.</p>
      {saving && (
        <div className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor={nameId} className="mb-1 block text-sm font-medium text-ink">
              Preset name
            </label>
            <input
              id={nameId}
              value={name}
              maxLength={60}
              placeholder="e.g. Job application photo"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && save()}
              className={inputClass}
            />
          </div>
          <Button variant="primary" className="shrink-0" disabled={!name.trim() || !current} onClick={save}>
            Save preset
          </Button>
        </div>
      )}
      {message && (
        <p className="mt-2 text-sm text-navy-700" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
