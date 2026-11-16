import JSZip from 'jszip';
import { splitName } from './format';

/** Makes every name unique (ignoring case) by appending " (2)", " (3)" … before the extension. */
export function dedupeNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const { base, ext } = splitName(name);
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) {
      candidate = ext ? `${base} (${n}).${ext}` : `${base} (${n})`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export async function buildZip(
  files: { name: string; blob: Blob }[],
  onProgress?: (percent: number) => void,
): Promise<Blob> {
  const zip = new JSZip();
  const names = dedupeNames(files.map((f) => f.name));
  files.forEach((file, i) => zip.file(names[i], file.blob));
  // The files are already compressed formats, so they are stored as-is.
  return zip.generateAsync({ type: 'blob', compression: 'STORE' }, (meta) => onProgress?.(meta.percent));
}
