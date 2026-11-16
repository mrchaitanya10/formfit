import { formatBytes } from './format';
import { LIMITS } from './limits';

/** An error whose message is written for the person using the app. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
}

export function errorMessage(error: unknown): string {
  if (error instanceof UserError) return error.message;
  console.error(error);
  return 'Something went wrong while processing this file. Please try again or use a different file.';
}

export type ImageKind = 'jpeg' | 'png' | 'webp';
export type FileKind = ImageKind | 'pdf';

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
export const PDF_ACCEPT = 'application/pdf,.pdf';

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((value, i) => bytes[offset + i] === value);
}

/** Identifies a file from its first bytes, so a wrong extension cannot fool the app. */
export function sniffBytes(bytes: Uint8Array): FileKind | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  // The PDF header may be preceded by a few stray bytes.
  const limit = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= limit; i++) {
    if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d], i)) return 'pdf';
  }
  return null;
}

export async function sniffFile(file: Blob): Promise<FileKind | null> {
  const head = new Uint8Array(await file.slice(0, 1100).arrayBuffer());
  return sniffBytes(head);
}

export async function validateImageFile(file: File): Promise<ImageKind> {
  if (file.size === 0) throw new UserError(`“${file.name}” is empty (0 bytes).`);
  if (file.size > LIMITS.imageBytes) {
    throw new UserError(
      `“${file.name}” is ${formatBytes(file.size)}. Images up to ${formatBytes(LIMITS.imageBytes)} are supported.`,
    );
  }
  const kind = await sniffFile(file);
  if (kind === 'jpeg' || kind === 'png' || kind === 'webp') return kind;
  throw new UserError(`“${file.name}” is not a JPEG, PNG or WebP image.`);
}

export async function validatePdfFile(file: File): Promise<void> {
  if (file.size === 0) throw new UserError(`“${file.name}” is empty (0 bytes).`);
  if (file.size > LIMITS.pdfBytes) {
    throw new UserError(
      `“${file.name}” is ${formatBytes(file.size)}. PDFs up to ${formatBytes(LIMITS.pdfBytes)} are supported.`,
    );
  }
  if ((await sniffFile(file)) !== 'pdf') throw new UserError(`“${file.name}” is not a PDF file.`);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
