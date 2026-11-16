export type PageRangeResult = { ok: true; pages: number[] } | { ok: false; error: string };

/**
 * Parses selections such as "1–3, 5, 8" into 1-based page numbers.
 * Pages are returned in the order written, without repeats.
 */
export function parsePageRanges(text: string, pageCount: number): PageRangeResult {
  const normalized = text
    .replace(/[‐-―−]/g, '-') // en dash, em dash, minus sign and friends
    .replace(/\s*-\s*/g, '-')
    .trim();
  if (!normalized) return { ok: false, error: 'Enter the pages to extract, for example “1–3, 5, 8”.' };

  const pages: number[] = [];
  const seen = new Set<number>();
  for (const token of normalized.split(/[,;\s]+/).filter(Boolean)) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(token);
    if (!match) {
      return { ok: false, error: `“${token}” is not a page number or range. Use numbers like “4” or ranges like “2–6”.` };
    }
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (start < 1 || end < 1) return { ok: false, error: 'Page numbers start at 1.' };
    if (start > end) {
      return { ok: false, error: `The range “${start}–${end}” runs backwards. Write it as “${end}–${start}”.` };
    }
    if (end > pageCount) {
      const pagesWord = pageCount === 1 ? 'page' : 'pages';
      return { ok: false, error: `Page ${end} does not exist — this PDF has ${pageCount} ${pagesWord}.` };
    }
    for (let page = start; page <= end; page++) {
      if (!seen.has(page)) {
        seen.add(page);
        pages.push(page);
      }
    }
  }
  return { ok: true, pages };
}

/** Turns page numbers into a compact, sorted range string such as "1–3, 5". */
export function formatPageRanges(pages: Iterable<number>): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(start === sorted[i] ? `${start}` : `${start}–${sorted[i]}`);
  }
  return parts.join(', ');
}
