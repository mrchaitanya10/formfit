import { useEffect, useId, useState } from 'react';
import { downloadBlob } from '../lib/files';
import { sanitizeBaseName, splitName } from '../lib/format';
import { href } from '../state/router';
import { type KitItem, useKit } from '../state/kit';
import { Button, inputClass } from './ui';

interface Props {
  blob: Blob;
  /** Suggested file name including extension. */
  suggestedName: string;
  kind: KitItem['kind'];
  width?: number;
  height?: number;
  pages?: number;
}

/** File name, Download and Add-to-kit controls. Stays within thumb reach on phones. */
export function OutputActions({ blob, suggestedName, kind, width, height, pages }: Props) {
  const kit = useKit();
  const nameId = useId();
  const { base: suggestedBase, ext } = splitName(suggestedName);
  const [base, setBase] = useState(suggestedBase);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setBase(suggestedBase), [suggestedBase]);
  useEffect(() => setStatus(null), [blob]);

  const fileName = `${sanitizeBaseName(base) || suggestedBase}.${ext}`;

  function addToKit() {
    const error = kit.add({ name: fileName, blob, kind, width, height, pages });
    setStatus(error ? { ok: false, text: error } : { ok: true, text: `Added “${fileName}” to your kit.` });
  }

  return (
    <div className="sm:rounded-xl sm:border sm:border-navy-200 sm:p-4">
      <label htmlFor={nameId} className="mb-1 block text-sm font-medium text-ink">
        File name
      </label>
      <div className="flex items-center gap-2">
        <input id={nameId} value={base} onChange={(event) => setBase(event.target.value)} className={inputClass} maxLength={120} />
        <span className="shrink-0 text-sm text-navy-500">.{ext}</span>
      </div>
      {/* On phones the two buttons stay pinned to the bottom of the screen. */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-3 grid grid-cols-2 gap-2 border-t border-navy-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button variant="primary" onClick={() => downloadBlob(blob, fileName)}>
          Download
        </Button>
        <Button onClick={addToKit}>Add to kit</Button>
      </div>
      {status && (
        <p className={`mt-2 text-sm ${status.ok ? 'text-emerald-800' : 'text-red-700'}`} role="status">
          {status.text}{' '}
          {status.ok && (
            <a href={href('kit')} className="font-medium text-brand underline">
              View kit
            </a>
          )}
        </p>
      )}
    </div>
  );
}
