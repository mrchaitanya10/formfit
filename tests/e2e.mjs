// End-to-end check of FormFit's main workflows in a real browser.
//
//   npm run build && npm run test:e2e
//
// Serves ./dist from a sub-path (to prove relative asset paths work), creates sample
// files locally, drives the app with Playwright and inspects every downloaded file.
// Set CHROME_PATH to use an already-installed Chrome instead of Playwright's Chromium.
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = join(root, 'tests', 'output');
mkdirSync(outDir, { recursive: true });
if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ not found. Run "npm run build" first.');

/* ---------- tiny static server ---------- */
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2',
  '.json': 'application/json', '.svg': 'image/svg+xml',
};
const PREFIX = '/formfit/';
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith(PREFIX)) return res.writeHead(404).end();
  const rel = normalize(decodeURIComponent(url.pathname.slice(PREFIX.length)) || 'index.html');
  const file = join(dist, rel);
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}${PREFIX}`;

/* ---------- reporting ---------- */
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n== ${title}`);
}

/* ---------- file inspection helpers ---------- */
function imageInfo(buf) {
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') {
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i < buf.length; ) {
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc2) return { type: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return { type: 'unknown', width: 0, height: 0 };
}
/** Visible page sizes (rotation applied), rounded to whole points. */
async function pdfPageSizes(buf) {
  const doc = await PDFDocument.load(buf);
  return doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    const turned = Math.abs(p.getRotation().angle % 180) === 90;
    return `${Math.round(turned ? height : width)}x${Math.round(turned ? width : height)}`;
  });
}
async function pdfTexts(buf) {
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }).promise;
  const texts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    texts.push(content.items.map((it) => it.str).join(' '));
  }
  await doc.loadingTask.destroy();
  return texts;
}

/* ---------- sample PDFs ---------- */
async function makePdf(pages, { withPhoto = false, extra } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const photo = withPhoto ? await doc.embedJpg(withPhoto) : null;
  pages.forEach(({ w, h, label, rotate }, i) => {
    const page = doc.addPage([w, h]);
    page.drawText(label, { x: 40, y: h - 80, size: 36, font, color: rgb(0.08, 0.14, 0.23) });
    for (let line = 0; line < 12; line++) {
      page.drawText(`${label} · line ${line + 1}: the quick brown fox jumps over the lazy dog 0123456789`, { x: 40, y: h - 120 - line * 16, size: 10, font });
    }
    if (photo) page.drawImage(photo, { x: 40, y: 40, width: Math.min(w, h) - 200, height: (Math.min(w, h) - 200) * 0.75 });
    if (rotate) page.setRotation(degrees(rotate));
    void i;
  });
  extra?.(doc);
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/* ---------- browser ---------- */
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
const page = await context.newPage();
const consoleErrors = [];
const externalRequests = [];
const failedRequests = [];
function watch(p) {
  p.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  p.on('pageerror', (e) => consoleErrors.push(String(e)));
  p.on('request', (r) => !r.url().startsWith(BASE) && !/^(blob|data):/.test(r.url()) && externalRequests.push(r.url()));
  p.on('response', (r) => r.status() >= 400 && failedRequests.push(`${r.status()} ${r.url()}`));
}
watch(page);

await page.goto(BASE);
await page.waitForSelector('h1');

/** Draws a sample image in the browser and returns it as a file payload. */
async function makeImage(name, w, h, mime, style) {
  const b64 = await page.evaluate(
    ({ w, h, mime, style }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const x = c.getContext('2d');
      if (style.noise) {
        const d = x.createImageData(w, h);
        for (let i = 0; i < d.data.length; i++) d.data[i] = i % 4 === 3 ? 255 : Math.random() * 256;
        x.putImageData(d, 0, 0);
      } else if (style.fill) {
        x.fillStyle = style.fill;
        x.fillRect(0, 0, w, h);
      }
      if (style.photo) {
        const g = x.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#7aa7ff');
        g.addColorStop(1, '#ffd9a8');
        x.fillStyle = g;
        x.fillRect(0, 0, w, h);
        const d = x.getImageData(0, 0, w, h);
        for (let i = 0; i < d.data.length; i += 4) for (let k = 0; k < 3; k++) d.data[i + k] += (Math.random() - 0.5) * 40;
        x.putImageData(d, 0, 0);
        x.fillStyle = '#5b3a29';
        x.beginPath();
        x.arc(w / 2, h * 0.42, h * 0.2, 0, 7);
        x.fill();
        x.fillRect(w * 0.3, h * 0.65, w * 0.4, h * 0.4);
      }
      if (style.circle) {
        x.fillStyle = style.circle;
        x.beginPath();
        x.arc(w / 2, h / 2, Math.min(w, h) * 0.3, 0, 7);
        x.fill();
      }
      if (style.text) {
        x.fillStyle = '#fff';
        x.font = `bold ${Math.min(w, h) * 0.5}px sans-serif`;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillText(style.text, w / 2, h / 2);
      }
      return c.toDataURL(mime, 0.9).split(',')[1];
    },
    { w, h, mime, style },
  );
  return { name, mimeType: mime, buffer: Buffer.from(b64, 'base64') };
}

async function download(action, saveAs) {
  const [dl] = await Promise.all([page.waitForEvent('download'), action()]);
  const buf = readFileSync(await dl.path());
  if (saveAs) writeFileSync(join(outDir, saveAs), buf);
  return { buf, name: dl.suggestedFilename() };
}
const fileInput = () => page.locator('input[type=file]').first();
async function photoReady() {
  await page.waitForTimeout(150);
  await page.locator('[aria-busy="false"]').waitFor({ timeout: 30000 });
}
const go = async (path) => {
  // Visit home first so the tool is always freshly opened.
  await page.goto(`${BASE}#/`);
  await page.goto(`${BASE}#/${path}`);
  await page.waitForTimeout(100);
};

const photo = await makeImage('portrait.jpg', 1600, 1200, 'image/jpeg', { photo: true });
const noise = await makeImage('noise.png', 800, 800, 'image/png', { noise: true });
const alpha = await makeImage('stamp.png', 400, 400, 'image/png', { circle: '#1d4ed8' });
const imgA = await makeImage('a.png', 300, 400, 'image/png', { fill: '#c0392b', text: 'A' });
const imgB = await makeImage('b.jpg', 500, 300, 'image/jpeg', { fill: '#27ae60', text: 'B' });
const imgC = await makeImage('c.webp', 240, 240, 'image/webp', { fill: '#2980b9', text: 'C' });

const five = [
  { w: 595, h: 842, label: 'Page 1' },
  { w: 595, h: 842, label: 'Page 2' },
  { w: 842, h: 595, label: 'Page 3' },
  { w: 595, h: 842, label: 'Page 4', rotate: 90 },
  { w: 420, h: 595, label: 'Page 5' },
];
const pdfFive = await makePdf(five, { withPhoto: photo.buffer });
const pdfA = await makePdf([{ w: 300, h: 300, label: 'A1' }, { w: 300, h: 300, label: 'A2' }]);
const pdfB = await makePdf([{ w: 400, h: 500, label: 'B1' }, { w: 400, h: 500, label: 'B2' }, { w: 400, h: 500, label: 'B3' }]);
const pdfText = await makePdf([{ w: 595, h: 842, label: 'Text only' }]);
const pdfSigned = await makePdf([{ w: 595, h: 842, label: 'Signed' }], { extra: (d) => d.catalog.set(PDFName.of('Note'), PDFString.of('/ByteRange')) });
const asPdf = (name, buffer) => ({ name, mimeType: 'application/pdf', buffer });

/* ================= 1. Photo: exact dimensions ================= */
section('1. Crop and export a photo with exact dimensions');
await go('photo');
await fileInput().setInputFiles(photo);
await page.getByLabel('Width (px)').fill('413');
await page.getByLabel('Height (px)').fill('531');
await page.getByRole('button', { name: 'Rotate right' }).click();
await page.getByRole('button', { name: 'Rotate left' }).click();
const cropCanvas = page.getByRole('img', { name: /Crop area/ });
const box = await cropCanvas.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2, { steps: 5 });
await page.mouse.up();
await cropCanvas.focus();
await page.keyboard.press('+');
await page.keyboard.press('ArrowLeft');
await photoReady();
let dl = await download(() => page.getByRole('button', { name: 'Download', exact: true }).click(), '1-photo-413x531.jpg');
let info = imageInfo(dl.buf);
check('downloaded photo is a JPEG of exactly 413 × 531', info.type === 'jpeg' && info.width === 413 && info.height === 531, `${info.type} ${info.width}×${info.height}, ${dl.buf.length} bytes, "${dl.name}"`);
check('UI reports measured dimensions and "Ready"', (await page.getByText('Dimensions are 413 × 531 px').count()) === 1 && (await page.getByText('Ready', { exact: true }).count()) === 1);
const unlimitedBytes = dl.buf.length;
await page.screenshot({ path: join(outDir, 'desktop-photo.png'), fullPage: true });

/* ================= 2. Size-limited export ================= */
section('2. Size-limited image export');
const limitKb = Math.max(8, Math.floor(unlimitedBytes / 1000 / 3));
await page.getByLabel(/Maximum file size/).fill(String(limitKb));
await photoReady();
dl = await download(() => page.getByRole('button', { name: 'Download', exact: true }).click(), '2-photo-limited.jpg');
info = imageInfo(dl.buf);
check(`file is within ${limitKb} KB (${limitKb * 1000} bytes)`, dl.buf.length <= limitKb * 1000, `${dl.buf.length} bytes (unlimited export was ${unlimitedBytes})`);
check('dimensions unchanged at 413 × 531', info.width === 413 && info.height === 531);
check('UI says requirements are met', (await page.getByText('Meets the requirements you entered').count()) === 1);
await page.getByRole('button', { name: 'Add to kit' }).click();
await page.getByRole('button', { name: 'Add to kit' }).click(); // same name twice on purpose

/* ================= 3. Impossible target ================= */
section('3. Impossible size target');
await fileInput().setInputFiles(noise);
await page.getByLabel('Width (px)').fill('1000');
await page.getByLabel('Height (px)').fill('1000');
await page.getByLabel(/Maximum file size/).fill('5');
await photoReady();
check('UI states the limit could not be reached', (await page.getByText('The 5.0 KB limit could not be reached').count()) === 1);
check('UI does not claim success', (await page.getByText('Meets the requirements you entered').count()) === 0);
dl = await download(() => page.getByRole('button', { name: 'Download', exact: true }).click(), '3-impossible.jpg');
info = imageInfo(dl.buf);
check('best-effort file really is over the limit and keeps 1000 × 1000', dl.buf.length > 5000 && info.width === 1000 && info.height === 1000, `${dl.buf.length} bytes`);
await page.screenshot({ path: join(outDir, 'desktop-impossible.png'), fullPage: true });
await page.getByRole('button', { name: /Raise limit to/ }).click();
await photoReady();
check('"Raise limit" adjustment leads to a met target', (await page.getByText('Meets the requirements you entered').count()) === 1);
await page.getByLabel(/Maximum file size/).fill('5');
await page.getByRole('group', { name: 'Output format' }).getByRole('button', { name: 'PNG' }).click();
await photoReady();
check('PNG over the limit is reported with a JPEG suggestion', (await page.getByRole('button', { name: 'Switch to JPEG' }).count()) === 1);

section('3b. Transparent input → JPEG background, signature mode');
await go('photo');
await fileInput().setInputFiles(alpha);
await page.getByLabel('Width (px)').fill('200');
await page.getByLabel('Height (px)').fill('200');
await page.locator('input[type=color]').fill('#ff0000');
await photoReady();
check('transparency notice is shown', (await page.getByText('This image has transparent areas').count()) === 1);
dl = await download(() => page.getByRole('button', { name: 'Download', exact: true }).click(), '3b-red-background.jpg');
const corner = await page.evaluate(async (b64) => {
  const bmp = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const x = c.getContext('2d');
  x.drawImage(bmp, 0, 0);
  return [...x.getImageData(3, 3, 1, 1).data];
}, dl.buf.toString('base64'));
check('JPEG corner pixel is the chosen background colour (red)', corner[0] > 235 && corner[1] < 25 && corner[2] < 25, `rgba(${corner})`);
await page.getByRole('group', { name: 'Document type' }).getByRole('button', { name: 'Signature' }).click();
await page.getByRole('group', { name: 'Output format' }).getByRole('button', { name: 'PNG' }).click();
await photoReady();
dl = await download(() => page.getByRole('button', { name: 'Download', exact: true }).click(), '3b-signature.png');
info = imageInfo(dl.buf);
check('signature mode exports a wide 600 × 200 PNG', info.type === 'png' && info.width === 600 && info.height === 200);
check('white background is on by default in signature mode', await page.getByLabel('White background').isChecked());
await page.getByRole('button', { name: 'Add to kit' }).click();

section('3c. Bad image files');
await fileInput().setInputFiles({ name: 'empty.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(0) });
await page.getByText('is empty (0 bytes)').waitFor();
check('empty file is rejected', true);
await fileInput().setInputFiles({ name: 'notes.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('just some text') });
await page.getByText('is not a JPEG, PNG or WebP image').waitFor();
check('wrong file type is rejected', true);
await fileInput().setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: noise.buffer.subarray(0, 60) });
await page.getByText('could not be opened').waitFor();
check('truncated image is rejected', true);

/* ================= 4. Images to PDF ================= */
section('4. Reordered images to PDF');
await go('images-to-pdf');
await fileInput().setInputFiles([imgA, imgB, imgC]);
await page.getByText('3 images').waitFor();
await page.getByRole('button', { name: 'Create PDF' }).click();
dl = await download(() => page.getByRole('button', { name: 'Download', exact: true }).click(), '4-images-a4.pdf');
let sizes = await pdfPageSizes(dl.buf);
check('A4 portrait: three 595 × 842 pages', sizes.join(',') === '595x842,595x842,595x842', sizes.join(','));
// Reorder to C, A, B (button then drag), rotate B, and use image-sized pages so order shows in page sizes.
await page.getByRole('button', { name: 'Move c.webp earlier' }).click();
await page.locator('ol > li').nth(1).dragTo(page.locator('ol > li').nth(0)); // c ahead of a
await page.getByRole('button', { name: 'Rotate b.jpg' }).click();
await page.getByRole('button', { name: 'Same as image' }).click();
await page.getByLabel('Margin (mm)').fill('0');
const order = await page.locator('ol > li p.truncate').allTextContents();
check('list order after button + drag is c, a, b', order.join('|') === '1. c.webp|2. a.png|3. b.jpg', order.join('|'));
await page.getByRole('button', { name: 'Create PDF' }).click();
dl = await download(() => page.getByRole('button', { name: 'Download', exact: true }).click(), '4-images-reordered.pdf');
sizes = await pdfPageSizes(dl.buf);
check('PDF pages follow the new order, with B rotated and nothing stretched', sizes.join(',') === '180x180,225x300,225x375', sizes.join(','));
await page.getByRole('button', { name: 'Remove a.png' }).click();
check('removing an image discards the outdated PDF', (await page.getByRole('button', { name: 'Download', exact: true }).count()) === 0 && (await page.locator('ol > li').count()) === 2);
await page.screenshot({ path: join(outDir, 'desktop-images-to-pdf.png'), fullPage: true });

/* ================= 5. Compress PDF ================= */
section('5. Compress a multipage PDF');
await go('compress');
await fileInput().setInputFiles(asPdf('report.pdf', pdfFive));
await page.getByText('Smaller PDF — converts pages to images').waitFor();
check('image-conversion mode is labelled and explained before processing', (await page.getByText(/can lose selectable and searchable text, links, form fields/).count()) === 1);
const targetKb = Math.floor(pdfFive.length / 1000 / 4);
await page.getByLabel('Maximum file size (KB)').fill(String(targetKb));
await page.getByRole('button', { name: 'Compress PDF' }).click();
await page.getByRole('button', { name: 'Cancel' }).click();
await page.waitForTimeout(400);
check('cancelling stops the job and shows no result', (await page.getByText('Preview and download').count()) === 0 && (await page.getByRole('button', { name: 'Compress PDF' }).count()) === 1);
await page.getByRole('button', { name: 'Compress PDF' }).click();
await page.getByText('Preview and download').waitFor({ timeout: 120000 });
dl = await download(() => page.getByRole('button', { name: 'Download', exact: true }).click(), '5-compressed.pdf');
sizes = await pdfPageSizes(dl.buf);
const original = await pdfPageSizes(pdfFive);
check('all 5 pages present, same order, orientation and size', sizes.join(',') === original.join(','), `${sizes.join(',')}`);
check(`output within ${targetKb} KB target`, dl.buf.length <= targetKb * 1000, `${pdfFive.length} → ${dl.buf.length} bytes`);
check('UI shows sizes, reduction and page check', (await page.getByText('5 of 5 pages present').count()) === 1 && (await page.getByText(/% smaller/).count()) === 1 && (await page.getByText('Under your size limit').count()) === 1);
await page.getByText('Page 1 of 5').waitFor();
await page.waitForTimeout(800);
await page.screenshot({ path: join(outDir, 'desktop-compress.png'), fullPage: true });
await page.getByRole('button', { name: 'Add to kit' }).click();
writeFileSync(join(outDir, '5-original.pdf'), pdfFive);

await page.getByLabel('Maximum file size (KB)').fill('5');
check('changing a setting discards the outdated result', (await page.getByText('Preview and download').count()) === 0);
await page.getByRole('button', { name: 'Compress PDF' }).click();
await page.getByText('Preview and download').waitFor({ timeout: 180000 });
check('unreachable PDF target is marked unmet after bounded attempts', (await page.getByText(/Target not met/).count()) === 1 && (await page.getByText(/^[1-6] of 6$/).count()) === 1, await page.getByText(/^[1-6] of 6$/).textContent());

await fileInput().setInputFiles(asPdf('text.pdf', pdfText));
await page.getByText('text.pdf').waitFor();
await page.getByLabel('Maximum file size (KB)').fill('');
await page.getByRole('button', { name: 'Compress PDF' }).click();
await page.getByText('Preview and download').waitFor({ timeout: 60000 });
check('larger-than-original output is reported', (await page.getByText('not smaller than your original').count()) === 1);
dl = await download(() => page.getByRole('button', { name: 'Download original' }).click());
check('"Download original" returns the untouched file', dl.buf.equals(pdfText));

await fileInput().setInputFiles(asPdf('signed.pdf', pdfSigned));
await page.getByText('appears to contain a digital signature').waitFor();
const compressBtn = page.getByRole('button', { name: 'Compress PDF' });
const blocked = await compressBtn.isDisabled();
await page.getByLabel('I understand the new file will not be digitally signed').check();
check('signature warning must be acknowledged before rewriting', blocked && (await compressBtn.isEnabled()));

await fileInput().setInputFiles(asPdf('garbage.pdf', Buffer.from('%PDF-1.7\nthis is not really a pdf')));
await page.getByText(/damaged or is not a valid PDF|does not support/).waitFor();
check('malformed PDF gets a clear message', true);
await fileInput().setInputFiles(asPdf('empty.pdf', Buffer.alloc(0)));
await page.getByText('is empty (0 bytes)').waitFor();
check('empty PDF is rejected', true);
let encrypted = null;
try {
  writeFileSync(join(outDir, 'plain.pdf'), pdfA);
  execFileSync('qpdf', ['--encrypt', 'secret', 'owner', '256', '--', join(outDir, 'plain.pdf'), join(outDir, 'locked.pdf')]);
  encrypted = readFileSync(join(outDir, 'locked.pdf'));
} catch {
  console.log('SKIP  encrypted-PDF checks (qpdf not available to create a sample)');
}
if (encrypted) {
  await fileInput().setInputFiles(asPdf('locked.pdf', encrypted));
  await page.getByText('is password-protected').waitFor();
  check('encrypted PDF is refused by the compressor with a clear message', true);
}

/* ================= 6. Merge and extract ================= */
section('6. Merge two PDFs and extract a page range');
await go('merge');
await fileInput().setInputFiles([asPdf('a.pdf', pdfA), asPdf('b.pdf', pdfB)]);
await page.getByText('2 files, 5 pages').waitFor();
await page.getByRole('button', { name: 'Move b.pdf up' }).click();
await page.getByRole('button', { name: 'Merge 2 PDFs' }).click();
dl = await download(() => page.getByRole('button', { name: 'Download', exact: true }).click(), '6-merged.pdf');
sizes = await pdfPageSizes(dl.buf);
let texts = await pdfTexts(dl.buf);
check('merged PDF has 5 pages in the chosen order (B then A)', sizes.join(',') === '400x500,400x500,400x500,300x300,300x300', sizes.join(','));
check('merged pages keep their real text', ['B1', 'B2', 'B3', 'A1', 'A2'].every((t, i) => texts[i].startsWith(t)), texts.map((t) => t.slice(0, 2)).join(','));
await page.getByRole('button', { name: 'Add to kit' }).click();
if (encrypted) {
  await fileInput().setInputFiles(asPdf('locked.pdf', encrypted));
  await page.getByText('is password-protected or encrypted').waitFor();
  check('encrypted PDF is refused by merge with a clear message', true);
}

await page.getByRole('button', { name: 'Extract pages' }).click();
await fileInput().setInputFiles(asPdf('report.pdf', pdfFive));
const ranges = page.getByLabel('Pages to extract');
await ranges.waitFor();
await ranges.fill('2–3, 5');
check('range "2–3, 5" is accepted as 3 pages', (await page.getByText('3 pages selected.').count()) === 1);
await page.getByRole('button', { name: 'Extract pages' }).last().click();
dl = await download(() => page.getByRole('button', { name: 'Download', exact: true }).click(), '6-extracted.pdf');
sizes = await pdfPageSizes(dl.buf);
texts = await pdfTexts(dl.buf);
check('extracted file has pages 2, 3 and 5 with original sizes', sizes.join(',') === [original[1], original[2], original[4]].join(','), sizes.join(','));
check('extracted pages keep selectable text', ['Page 2', 'Page 3', 'Page 5'].every((t, i) => texts[i].startsWith(t)));
await page.getByRole('button', { name: 'Page 4', exact: true }).click();
check('tapping a thumbnail updates the range text', (await ranges.inputValue()) === '2–5', await ranges.inputValue());
await page.waitForTimeout(600);
await page.screenshot({ path: join(outDir, 'desktop-extract.png'), fullPage: true });

/* ================= 7. Invalid ranges ================= */
section('7. Reject invalid page ranges');
const extractBtn = page.getByRole('button', { name: 'Extract pages' }).last();
for (const [input, message] of [
  ['4-9', 'Page 9 does not exist — this PDF has 5 pages.'],
  ['5-3', 'runs backwards'],
  ['0', 'Page numbers start at 1.'],
  ['2, x', 'is not a page number or range'],
]) {
  await ranges.fill(input);
  const shown = (await page.getByText(message).count()) === 1;
  check(`"${input}" is rejected with an explanation`, shown && (await extractBtn.isDisabled()), message);
}

/* ================= 8. Presets ================= */
section('8. Save and reload a requirement preset');
await go('photo');
await page.getByLabel('Width (px)').fill('350');
await page.getByLabel('Height (px)').fill('450');
await page.getByLabel(/Maximum file size/).fill('80');
await page.getByRole('button', { name: 'Save…' }).click();
await page.getByLabel('Preset name').fill('Job application photo');
await page.getByRole('button', { name: 'Save preset' }).click();
await page.getByText('Saved “Job application photo”.').waitFor();
const kitBeforeReload = await page.locator('header').getByText(/^\d+ items?$/).textContent().catch(() => '');
const storage = await page.evaluate(() => ({ keys: Object.keys(localStorage), value: localStorage.getItem('formfit.presets.v1'), session: sessionStorage.length }));
const stored = JSON.parse(storage.value);
check('localStorage holds only the preset settings', storage.keys.join() === 'formfit.presets.v1' && storage.session === 0 && Object.keys(stored[0]).sort().join() === 'docType,format,height,id,maxKb,name,width', storage.value);
await page.reload();
await go('presets');
check('preset is listed after a reload', (await page.getByText('Job application photo').count()) === 1 && (await page.getByText('350 × 450 px · JPEG · max 80 KB').count()) === 1);
check('examples are marked as examples', (await page.getByText('Example', { exact: true }).count()) === 4);
await page.getByRole('link', { name: 'Use preset Job application photo' }).click();
await page.getByRole('heading', { name: 'Photo and signature' }).waitFor();
check('using the preset restores its settings', (await page.getByLabel('Width (px)').inputValue()) === '350' && (await page.getByLabel('Height (px)').inputValue()) === '450' && (await page.getByLabel(/Maximum file size/).inputValue()) === '80');
check('kit was emptied by the reload (documents are not persisted)', (await page.locator('header a[href="#/kit"]').textContent()).includes('0'), `before reload: ${kitBeforeReload}`);

/* ================= 9. Kit ZIP ================= */
section('9. Application kit ZIP');
await fileInput().setInputFiles(photo);
await photoReady();
const add = page.getByRole('button', { name: 'Add to kit' });
await add.click();
await add.click(); // duplicate name
await page.getByRole('group', { name: 'Output format' }).getByRole('button', { name: 'PNG' }).click();
await page.getByLabel(/Maximum file size/).fill('');
await photoReady();
await add.click();
await add.click();
await page.getByRole('link', { name: 'View kit' }).click();
await page.getByText('4 files').waitFor();
check('duplicate names are flagged in the kit', (await page.getByText(/in the ZIP this file will be saved as/).count()) === 2);
await page.locator('main li').nth(3).getByRole('button', { name: /^Remove/ }).click();
await page.getByText('3 files').waitFor();
const thirdName = page.locator('main li input').nth(2);
await thirdName.fill('my photo');
await thirdName.blur();
await page.getByRole('textbox', { name: 'File name for my photo.png' }).waitFor();
await page.screenshot({ path: join(outDir, 'desktop-kit.png'), fullPage: true });
const listed = await page.locator('main li').evaluateAll((els) => els.map((el) => el.querySelector('p').textContent));
dl = await download(() => page.getByRole('button', { name: 'Download all as ZIP' }).click(), '9-kit.zip');
const zip = await JSZip.loadAsync(dl.buf);
const entries = Object.keys(zip.files);
const entrySizes = await Promise.all(entries.map(async (n) => (await zip.file(n).async('nodebuffer')).length));
check('ZIP contains 3 files with distinct names', entries.length === 3 && new Set(entries.map((e) => e.toLowerCase())).size === 3, entries.join(' | '));
check('duplicate was kept under a new name; renamed file uses its new name', entries.join('|') === 'portrait-photo-350x450.jpg|portrait-photo-350x450 (2).jpg|my photo.png');
const entryInfo = await Promise.all(entries.map(async (n) => imageInfo(await zip.file(n).async('nodebuffer'))));
check('zipped files are intact images of 350 × 450', entryInfo.every((i) => i.width === 350 && i.height === 450), entryInfo.map((i) => i.type).join(','));
check('kit rows show format, dimensions and size', listed.every((t) => /^(JPEG|PNG) · 350 × 450 px · [\d.]+ KB$/.test(t)), listed[0]);
console.log(`      zip entries: ${entries.map((n, i) => `${n} (${entrySizes[i]} B)`).join(', ')}`);

/* ================= Branding and layout ================= */
section('Branding assets, desktop');
await go('');
await page.waitForLoadState('networkidle');
const brand = await page.evaluate(async () => {
  const head = (sel) => document.querySelector(sel)?.href;
  const urls = { favicon: head('link[rel=icon]'), touch: head('link[rel=apple-touch-icon]'), manifest: head('link[rel=manifest]') };
  const manifest = await (await fetch(urls.manifest)).json();
  const iconUrls = manifest.icons.map((i) => new URL(i.src, urls.manifest).href);
  const fetched = {};
  for (const [k, u] of [...Object.entries(urls), ...iconUrls.map((u, i) => [`icon${i}`, u])]) {
    const r = await fetch(u);
    fetched[k] = `${r.status} ${r.headers.get('content-type')}`;
  }
  const imgs = [...document.querySelectorAll('img')].map((img) => {
    const r = img.getBoundingClientRect();
    return { src: new URL(img.src).pathname, alt: img.alt, ok: img.complete && img.naturalWidth > 0, w: Math.round(r.width), h: Math.round(r.height), ratio: +(r.width / r.height).toFixed(2), natural: +(img.naturalWidth / img.naturalHeight).toFixed(2), fit: getComputedStyle(img).objectFit, visible: r.width > 0 };
  });
  const css = getComputedStyle(document.documentElement);
  return { fetched, imgs, startUrl: new URL(manifest.start_url, urls.manifest).href, bg: css.backgroundColor, ink: getComputedStyle(document.querySelector('h1')).color, font: getComputedStyle(document.body).fontFamily };
});
check('favicon, touch icon, manifest and manifest icons all load', Object.values(brand.fetched).every((v) => v.startsWith('200')), JSON.stringify(brand.fetched));
check('manifest start_url resolves inside the app path', brand.startUrl === BASE, brand.startUrl);
const headerLogo = brand.imgs.find((i) => i.src.endsWith('brand/formfit-logo.png'));
const footerLogo = brand.imgs.filter((i) => i.src.endsWith('brand/formfit-logo.png'))[1];
const heroIcon = brand.imgs.find((i) => i.src.endsWith('brand/formfit-icon.png'));
check('header logo loads, alt="FormFit", aspect ratio preserved', headerLogo?.ok && headerLogo.alt === 'FormFit' && headerLogo.ratio === headerLogo.natural && headerLogo.fit === 'contain', JSON.stringify(headerLogo));
check('footer logo loads with aspect ratio preserved', footerLogo?.ok && footerLogo.ratio === footerLogo.natural, JSON.stringify(footerLogo));
check('symbol icon loads with empty alt beside the visible FormFit text', heroIcon?.ok && heroIcon.alt === '' && heroIcon.ratio === 1, JSON.stringify(heroIcon));
check('brand colours applied (page #F8FAFC, headings #14243B)', brand.bg === 'rgb(248, 250, 252)' && brand.ink === 'rgb(20, 36, 59)', `${brand.bg} / ${brand.ink}`);
check('home shows all six tools', (await page.locator('main ul > li > a').count()) === 6);
await page.screenshot({ path: join(outDir, 'desktop-home.png'), fullPage: true });
await page.locator('header').screenshot({ path: join(outDir, 'desktop-header.png') });
await page.locator('footer').screenshot({ path: join(outDir, 'desktop-footer.png') });
// Favicon at its real display sizes.
const ico = readFileSync(join(dist, 'favicon.ico'));
check('favicon.ico contains 16, 32, 48 and 64 px images', [...Array(ico.readUInt16LE(4)).keys()].map((i) => ico[6 + i * 16] || 256).sort((a, b) => a - b).join() === '16,32,48,64');
await page.setViewportSize({ width: 640, height: 120 });
await page.evaluate((base) => {
  const img = (src, size, extra = '') => `<img src="${base}${src}" width="${size}" height="${size}" style="${extra}">`;
  document.body.innerHTML = `<div style="position:fixed;inset:0;z-index:99;padding:12px;background:#dee1e6;display:flex;gap:16px;align-items:center;font:13px sans-serif">
    ${[16, 32, 48].map((s) => img('favicon.ico', s)).join('')}
    <div style="background:#fff;border-radius:8px 8px 0 0;padding:8px 12px;display:flex;gap:8px;align-items:center">${img('favicon.ico', 16)}FormFit — Documents ready.</div>
    ${img('apple-touch-icon.png', 60, 'border-radius:13px')}${img('brand/icon-192.png', 96)}</div>`;
}, BASE);
await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
check('favicon and app icons decode in the browser', true);
await page.waitForLoadState('networkidle');
await page.screenshot({ path: join(outDir, 'icons.png') });
await page.close();

section('Mobile layout (390 × 844, touch)');
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
const m = await mobile.newPage();
watch(m);
const overflow = () => m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await m.goto(BASE);
await m.waitForLoadState('networkidle');
const mLogo = await m.locator('header img').evaluate((img) => ({ ok: img.naturalWidth > 0, w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height }));
check('mobile header logo renders', mLogo.ok && mLogo.w > 100 && mLogo.w < 200, JSON.stringify(mLogo));
check('mobile home has no horizontal overflow', (await overflow()) <= 0);
await m.screenshot({ path: join(outDir, 'mobile-home.png'), fullPage: true });
await m.goto(`${BASE}#/photo`);
await m.locator('input[type=file]').first().setInputFiles(photo);
await m.locator('[aria-busy="false"]').waitFor({ timeout: 30000 });
check('mobile photo tool has no horizontal overflow', (await overflow()) <= 0);
await m.getByRole('button', { name: 'Download', exact: true }).scrollIntoViewIfNeeded();
const sticky = await m.getByRole('button', { name: 'Download', exact: true }).evaluate((b) => {
  const r = b.getBoundingClientRect();
  return { h: r.height, inView: r.bottom <= window.innerHeight && r.top >= 0 };
});
check('mobile primary action is ≥ 44 px tall and on screen', sticky.h >= 44 && sticky.inView, JSON.stringify(sticky));
const [mdl] = await Promise.all([m.waitForEvent('download'), m.getByRole('button', { name: 'Download', exact: true }).tap()]);
const mInfo = imageInfo(readFileSync(await mdl.path()));
check('mobile download works (600 × 600 JPEG)', mInfo.type === 'jpeg' && mInfo.width === 600 && mInfo.height === 600);
await m.screenshot({ path: join(outDir, 'mobile-photo-result.png') });
await m.evaluate(() => window.scrollTo(0, 0));
await m.screenshot({ path: join(outDir, 'mobile-photo.png'), fullPage: true });
await m.goto(`${BASE}#/merge`);
await m.locator('input[type=file]').first().setInputFiles([asPdf('a.pdf', pdfA), asPdf('b.pdf', pdfB)]);
await m.getByText('2 files, 5 pages').waitFor();
check('mobile merge tool has no horizontal overflow', (await overflow()) <= 0);
await m.screenshot({ path: join(outDir, 'mobile-merge.png'), fullPage: true });
await m.goto(`${BASE}#/kit`);
await m.locator('footer').scrollIntoViewIfNeeded();
await m.locator('footer').screenshot({ path: join(outDir, 'mobile-footer.png') });

section('Privacy and stability');
check('no requests left the local server', externalRequests.length === 0, externalRequests.slice(0, 3).join(', '));
check('no failed asset requests', failedRequests.length === 0, failedRequests.slice(0, 3).join(', '));
const expected = /password|Invalid PDF|InvalidPDF|PasswordException|encrypted|Failed to parse|No PDF header|UnknownErrorException|Bad|XRef|pdf-lib/i;
const unexpected = consoleErrors.filter((e) => !expected.test(e));
check('no unexpected console errors', unexpected.length === 0, unexpected.slice(0, 3).join(' || '));

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`);
if (failed.length) {
  console.log('Failed:\n' + failed.map((f) => `  - ${f.name}`).join('\n'));
  process.exit(1);
}
