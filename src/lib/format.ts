// FormFit uses decimal units everywhere: 1 KB = 1,000 bytes, 1 MB = 1,000,000 bytes.
export const BYTES_PER_KB = 1000;

export function kbToBytes(kb: number): number {
  return Math.floor(kb * BYTES_PER_KB);
}

export function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  if (bytes < 1_000_000) {
    const kb = bytes / BYTES_PER_KB;
    return `${kb < 100 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  // Up to two decimals, without trailing zeros (25 MB, 1.5 MB, 2.35 MB).
  return `${Number((bytes / 1_000_000).toFixed(2))} MB`;
}

/** Positive when the output is smaller than the original. */
export function percentReduction(original: number, output: number): number {
  if (original <= 0) return 0;
  return ((original - output) / original) * 100;
}

export function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot + 1) };
}

/** Removes characters that are not allowed in file names on common systems. */
export function sanitizeBaseName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, '');
  return cleaned.slice(0, 120);
}

/** Parses a whole number typed by the user; returns null when empty or not a whole number. */
export function parseWholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}
