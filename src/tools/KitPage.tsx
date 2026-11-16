import { useEffect, useState } from 'react';
import { ToolPage } from '../components/Layout';
import { Alert, Button, Card, ProgressBar, inputClass } from '../components/ui';
import { downloadBlob, errorMessage } from '../lib/files';
import { formatBytes, splitName } from '../lib/format';
import { LIMITS } from '../lib/limits';
import { buildZip, dedupeNames } from '../lib/zip';
import { type KitItem, useKit } from '../state/kit';
import { href } from '../state/router';

function describe(item: KitItem): string {
  if (item.width && item.height) return `${item.width} × ${item.height} px`;
  if (item.pages) return `${item.pages} ${item.pages === 1 ? 'page' : 'pages'}`;
  return '—';
}

function KitRow({ item, zipName }: { item: KitItem; zipName: string }) {
  const kit = useKit();
  const { base, ext } = splitName(item.name);
  const [draft, setDraft] = useState(base);
  useEffect(() => setDraft(base), [base]);

  function commit() {
    if (!kit.rename(item.id, draft)) setDraft(base);
  }

  return (
    <li className="rounded-lg border border-navy-200 bg-white p-3">
      <div className="flex items-center gap-2">
        <input
          aria-label={`File name for ${item.name}`}
          value={draft}
          maxLength={120}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className={inputClass}
        />
        <span className="shrink-0 text-sm text-navy-500">.{ext}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-navy-600 tabular-nums">
          {item.kind.toUpperCase()} · {describe(item)} · {formatBytes(item.blob.size)}
        </p>
        <div className="flex gap-2">
          <Button small onClick={() => downloadBlob(item.blob, item.name)}>
            Download
          </Button>
          <Button small variant="danger" aria-label={`Remove ${item.name}`} onClick={() => kit.remove(item.id)}>
            Remove
          </Button>
        </div>
      </div>
      {zipName !== item.name && (
        <p className="mt-2 text-xs text-amber-800">Another item has this name, so in the ZIP this file will be saved as “{zipName}”.</p>
      )}
    </li>
  );
}

export function KitPage() {
  const kit = useKit();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const zipNames = dedupeNames(kit.items.map((item) => item.name));

  async function downloadZip() {
    setError(null);
    setProgress(0);
    try {
      const zip = await buildZip(kit.items, setProgress);
      downloadBlob(zip, 'formfit-application-kit.zip');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setProgress(null);
    }
  }

  return (
    <ToolPage
      title="Application kit"
      intro="Collect the files you have prepared and download them together as one ZIP. The kit is temporary: it is emptied when you close or reload this tab."
    >
      {kit.items.length === 0 ? (
        <Card>
          <p className="text-sm text-navy-600">
            Your kit is empty. Prepare a file with any tool, then choose “Add to kit”.{' '}
            <a href={href('')} className="font-medium text-brand underline">
              See all tools
            </a>
          </p>
        </Card>
      ) : (
        <>
          <Card title={`${kit.items.length} ${kit.items.length === 1 ? 'file' : 'files'} · ${formatBytes(kit.totalBytes)}`}>
            <ul className="space-y-2">
              {kit.items.map((item, i) => (
                <KitRow key={item.id} item={item} zipName={zipNames[i]} />
              ))}
            </ul>
            <p className="mt-3 text-xs text-navy-500">The kit holds up to {formatBytes(LIMITS.kitBytes)} in total.</p>
          </Card>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="sticky bottom-0 z-10 -mx-4 border-t border-navy-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
            {progress !== null ? (
              <ProgressBar value={progress} label="Building ZIP…" />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" className="flex-1 sm:flex-none" onClick={() => void downloadZip()}>
                  Download all as ZIP
                </Button>
                <Button variant="danger" onClick={kit.clear}>
                  Clear kit
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </ToolPage>
  );
}
