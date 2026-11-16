import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';
import { formatBytes, sanitizeBaseName, splitName } from '../lib/format';
import { LIMITS } from '../lib/limits';

export interface KitItem {
  id: string;
  name: string;
  blob: Blob;
  kind: 'jpeg' | 'png' | 'pdf';
  width?: number;
  height?: number;
  pages?: number;
}

interface KitApi {
  items: KitItem[];
  totalBytes: number;
  /** Returns an error message when the item cannot be added. */
  add: (item: Omit<KitItem, 'id'>) => string | null;
  /** Renames an item, keeping its extension. Returns false when the name is empty. */
  rename: (id: string, baseName: string) => boolean;
  remove: (id: string) => void;
  clear: () => void;
}

const KitContext = createContext<KitApi | null>(null);

/**
 * The application kit lives only in this component's memory. Nothing is written to
 * storage, so closing or reloading the tab discards every document.
 */
export function KitProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<KitItem[]>([]);
  const totalBytes = useMemo(() => items.reduce((sum, item) => sum + item.blob.size, 0), [items]);

  const add = useCallback(
    (item: Omit<KitItem, 'id'>) => {
      if (totalBytes + item.blob.size > LIMITS.kitBytes) {
        return `The kit can hold up to ${formatBytes(LIMITS.kitBytes)}. Remove something or download the kit first.`;
      }
      setItems((current) => [...current, { ...item, id: crypto.randomUUID() }]);
      return null;
    },
    [totalBytes],
  );

  const rename = useCallback((id: string, baseName: string) => {
    const base = sanitizeBaseName(baseName);
    if (!base) return false;
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, name: `${base}.${splitName(item.name).ext}` } : item)),
    );
    return true;
  }, []);

  const remove = useCallback((id: string) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const clear = useCallback(() => setItems([]), []);

  const api = useMemo(() => ({ items, totalBytes, add, rename, remove, clear }), [items, totalBytes, add, rename, remove, clear]);
  return <KitContext.Provider value={api}>{children}</KitContext.Provider>;
}

export function useKit(): KitApi {
  const kit = useContext(KitContext);
  if (!kit) throw new Error('useKit must be used inside KitProvider');
  return kit;
}
