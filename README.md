# FormFit

**Documents ready. Applications easier.**

FormFit prepares photos, signatures and PDFs for job applications, college admissions, exams and other online forms. Everything runs in the browser: there is no server, no account and no upload.

## Quick start

Requires Node.js 20.19 or newer.

```bash
npm install        # also copies the PDF.js worker and data files into public/pdfjs
npm run dev        # start the dev server
npm run build      # production build in dist/
npm run preview    # serve the production build
npm run typecheck  # TypeScript check
```

End-to-end tests (optional, needs a Chromium download once):

```bash
npx playwright install chromium
npm run build && npm run test:e2e
```

The tests create their own sample images and PDFs, drive the app in a real browser, and inspect every downloaded file. Downloads and screenshots are written to `tests/output/`.

The build uses relative paths (`base: './'`), so `dist/` can be hosted from any folder, including GitHub Pages. Serve it over HTTP; opening `index.html` from disk will not work because the PDF worker is a module.

## Tools

| Tool | What it does |
| --- | --- |
| Photo and signature | Crop JPEG, PNG or WebP to exact pixel dimensions, rotate and straighten, export JPEG or PNG, optionally under a maximum size. Signature mode starts with a wide frame and a white background. |
| Compress PDF | “Smaller PDF — converts pages to images”: renders each page with PDF.js and rebuilds the PDF from JPEGs, aiming for a size limit. |
| Images to PDF | Several images into one PDF: reorder, rotate, remove; A4 or image-sized pages, orientation and margins. |
| Merge and extract | Join PDFs in a chosen order, or copy pages such as `1–3, 5, 8` into a new file. |
| Requirement presets | Named sets of document type, dimensions, format and maximum size. |
| Application kit | A temporary collection of finished files, downloadable as one ZIP. |

## How local processing works

- Files are read with the browser's File API and held in memory only.
- Images are decoded with `createImageBitmap`, drawn on a `<canvas>` and encoded with `canvas.toBlob`.
- PDFs are rendered by PDF.js in a web worker, and written by pdf-lib. The PDF.js worker, fonts and character maps are served from this site (`public/pdfjs`, copied from `node_modules` by `scripts/copy-pdfjs-assets.mjs`), not from a CDN.
- ZIP files are built with JSZip.
- There is no analytics and no network request other than loading the app itself.
- `localStorage` holds one key, `formfit.presets.v1`, containing preset settings only (name, document type, width, height, format, maximum KB). No file names or contents are stored.
- The application kit lives in React state, so closing or reloading the tab discards it.

## Architecture

```
src/
  lib/          Processing with no React in it
    image.ts        decode, crop geometry, export, size-limited JPEG search, output verification
    pdfjs.ts        PDF.js setup, page rendering, signature detection
    pdfCompress.ts  image-based PDF compression with bounded attempts
    pdfBuild.ts     images → PDF, merge, extract (pdf-lib)
    pageRanges.ts   "1–3, 5, 8" parser and formatter
    presets.ts      preset validation and localStorage
    zip.ts          ZIP building and duplicate-name handling
    files.ts        file-type sniffing, validation, user-facing errors
    limits.ts       every size and page limit in one place
    format.ts       KB/MB formatting (1 KB = 1,000 bytes)
  components/   Shared UI: Dropzone, CropEditor, PdfPreview, OutputActions, Layout, form controls
  tools/        One file per screen
  state/        Hash router, kit context, preset and object-URL hooks
```

Design decisions worth knowing:

- **Outputs are measured, not assumed.** After an image export the file is decoded again and its type, pixel size and byte size are checked before the interface says a requirement is met. PDF outputs are re-opened to count pages.
- **Pixel dimensions are never changed to hit a size limit.** JPEG quality is found by binary search (at most 9 encodes). If the lowest quality is still too large, the tool says so and offers a higher limit or smaller dimensions as explicit choices.
- **PDF compression is bounded.** At most 6 attempts, each at lower resolution and quality. Unmet targets are labelled as unmet; outputs larger than the original are reported and the original is offered instead.
- **Stale work is discarded.** Changing a file or setting cancels running jobs (`AbortController`) or ignores their results (run counters). Object URLs, bitmaps, canvases and PDF documents are released when replaced or when a tool is closed.

## Limits

Set in `src/lib/limits.ts` and shown in the interface.

| | Limit |
| --- | --- |
| Image file | 25 MB, 50 megapixels |
| Exported photo or signature | 16–6000 px per side |
| PDF file | 100 MB |
| PDF compression | 150 pages |
| Merge and extract | 20 files, 1000 pages, 100 MB in total |
| Images to PDF | 60 images; long edge scaled down to 4000 px |
| Application kit | 300 MB |

## Processing limitations

- **Compressed PDFs are pictures of pages.** Selectable text, links, form fields, bookmarks and accessibility tags are lost. Text-only PDFs often get larger, in which case FormFit recommends keeping the original.
- **No lossless PDF optimisation.** There is no mode that recompresses embedded images while keeping text.
- **Password-protected PDFs are refused** rather than unlocked.
- **Digital signatures do not survive** compression, merging or extraction. The tools warn when a signature is detected; detection looks for `/ByteRange` and signature fields and may miss unusual files.
- **Merge and extract copy page content only.** Fillable form fields and bookmarks may not carry over.
- **Images to PDF re-encodes images** (JPEG and WebP as JPEG at quality 92, PNG as PNG) so that camera rotation is applied correctly.
- **PNG size cannot be tuned.** A PNG over the limit is reported with a suggestion to use JPEG.
- **Not every size limit is achievable.** Very small limits at large pixel dimensions cannot be met, and the tools say so.
- **Leaving a tool clears its work.** Add a result to the kit before switching tools.
- **Very large files can exhaust memory on phones** even inside the limits above.
- The crop editor is a small custom canvas component (`components/CropEditor.tsx`), not a third-party cropping library.
- The JavaScript bundle is about 1.2 MB before compression because PDF.js and pdf-lib load up front; the tools are not code-split.
- No ESLint configuration is included.

## Branding

Logo and icons are in `public/brand/`, with `favicon.ico`, `apple-touch-icon.png` and `site.webmanifest` in `public/`. They are raster PNGs; no vector master exists. Interface colours are defined as theme tokens at the top of `src/index.css` (`#2563EB` primary, `#14243B` ink, `#F8FAFC` page, white surfaces). The manifest provides icons and colours only; FormFit is not an installable or offline app.

## Credits

React, Vite, Tailwind CSS, PDF.js (`pdfjs-dist`), pdf-lib, JSZip and the Inter typeface.
