import { LIMITS } from './limits';

export type DocType = 'photo' | 'signature' | 'pdf';
export type OutputFormat = 'jpeg' | 'png' | 'pdf';

/** Everything a preset stores. No file names or document contents are ever saved. */
export interface Preset {
  id: string;
  name: string;
  docType: DocType;
  width: number | null;
  height: number | null;
  format: OutputFormat;
  maxKb: number | null;
}

/** Generic starting points only. Real requirements must come from the form the user is filling in. */
export const EXAMPLE_PRESETS: Preset[] = [
  { id: 'example-square-photo', name: 'Square photo', docType: 'photo', width: 600, height: 600, format: 'jpeg', maxKb: 200 },
  { id: 'example-portrait-photo', name: 'Portrait photo', docType: 'photo', width: 413, height: 531, format: 'jpeg', maxKb: 100 },
  { id: 'example-signature', name: 'Signature', docType: 'signature', width: 600, height: 200, format: 'jpeg', maxKb: 50 },
  { id: 'example-pdf', name: 'Supporting document', docType: 'pdf', width: null, height: null, format: 'pdf', maxKb: 500 },
];

export function isExamplePreset(preset: Preset): boolean {
  return preset.id.startsWith('example-');
}

const STORAGE_KEY = 'formfit.presets.v1';
const MAX_PRESETS = 50;

function validSide(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= LIMITS.outputSideMin && value <= LIMITS.outputSide;
}

/** Rebuilds a preset from untrusted data, keeping only the known fields. */
export function sanitizePreset(raw: unknown): Preset | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 60) : '';
  if (!name || typeof r.id !== 'string' || !r.id) return null;
  const maxKb =
    typeof r.maxKb === 'number' && Number.isInteger(r.maxKb) && r.maxKb >= 1 && r.maxKb <= LIMITS.maxTargetKb ? r.maxKb : null;
  if (r.docType === 'pdf') {
    return { id: r.id, name, docType: 'pdf', width: null, height: null, format: 'pdf', maxKb };
  }
  if (r.docType !== 'photo' && r.docType !== 'signature') return null;
  if (!validSide(r.width) || !validSide(r.height)) return null;
  if (r.format !== 'jpeg' && r.format !== 'png') return null;
  return { id: r.id, name, docType: r.docType, width: r.width, height: r.height, format: r.format, maxKb };
}

export function loadPresets(): Preset[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizePreset).filter((p): p is Preset => p !== null && !isExamplePreset(p)).slice(0, MAX_PRESETS);
  } catch {
    return [];
  }
}

/** Returns false when the browser refuses to store (private mode, storage full). */
export function savePresets(presets: Preset[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets.slice(0, MAX_PRESETS)));
    return true;
  } catch {
    return false;
  }
}

export function newPresetId(): string {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function describePreset(preset: Preset): string {
  const parts: string[] = [];
  if (preset.width && preset.height) parts.push(`${preset.width} × ${preset.height} px`);
  parts.push(preset.format.toUpperCase());
  parts.push(preset.maxKb ? `max ${preset.maxKb} KB` : 'no size limit');
  return parts.join(' · ');
}
