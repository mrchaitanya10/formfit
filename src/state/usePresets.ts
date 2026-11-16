import { useCallback, useState } from 'react';
import { type Preset, loadPresets, newPresetId, savePresets } from '../lib/presets';

/** Saved presets, kept in localStorage. Returns helpers that report whether saving worked. */
export function usePresets() {
  const [presets, setPresets] = useState<Preset[]>(loadPresets);

  const addPreset = useCallback(
    (preset: Omit<Preset, 'id'>): boolean => {
      const next = [...presets, { ...preset, id: newPresetId() }];
      if (!savePresets(next)) return false;
      setPresets(next);
      return true;
    },
    [presets],
  );

  const removePreset = useCallback(
    (id: string) => {
      const next = presets.filter((preset) => preset.id !== id);
      savePresets(next);
      setPresets(next);
    },
    [presets],
  );

  return { presets, addPreset, removePreset };
}
