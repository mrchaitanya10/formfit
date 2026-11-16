import type { ReactNode } from 'react';
import { ICON, PrivacyNote } from '../components/Layout';
import { formatBytes } from '../lib/format';
import { LIMITS } from '../lib/limits';
import { type RoutePath, href } from '../state/router';
import { useKit } from '../state/kit';

interface Tool {
  path: RoutePath;
  title: string;
  text: string;
  limit: string;
  icon: ReactNode;
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const TOOLS: Tool[] = [
  {
    path: 'photo',
    title: 'Photo and signature',
    text: 'Crop to exact pixels, pick JPEG or PNG, and stay under a size limit.',
    limit: `JPEG, PNG, WebP · up to ${formatBytes(LIMITS.imageBytes)}`,
    icon: <path {...stroke} d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M12 9.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM8 16.5c.8-1.5 2.3-2.2 4-2.2s3.2.7 4 2.2" />,
  },
  {
    path: 'compress',
    title: 'Compress PDF',
    text: 'Shrink a PDF towards an upload limit by converting its pages to images.',
    limit: `PDF · up to ${formatBytes(LIMITS.pdfBytes)}, ${LIMITS.compressPages} pages`,
    icon: <path {...stroke} d="M7 3h7l4 4v14H7zM14 3v4h4M12 10v6M9.5 13.5 12 16l2.5-2.5" />,
  },
  {
    path: 'images-to-pdf',
    title: 'Images to PDF',
    text: 'Turn photos or scans into one PDF, in the page order you choose.',
    limit: `Up to ${LIMITS.imagesPerPdf} images`,
    icon: <path {...stroke} d="M4 5h11v11H4zM4 13l3-3 3 3 2-2 3 3M9 19h11V8" />,
  },
  {
    path: 'merge',
    title: 'Merge and extract',
    text: 'Join several PDFs, or pull chosen pages such as “1–3, 5” into a new file.',
    limit: `PDF · up to ${LIMITS.pdfPages} pages in total`,
    icon: <path {...stroke} d="M5 4h6v7H5zM13 13h6v7h-6zM11 7.5h3.5a1.5 1.5 0 0 1 1.5 1.5v4M13 16.5H9.5A1.5 1.5 0 0 1 8 15v-4" />,
  },
  {
    path: 'presets',
    title: 'Requirement presets',
    text: 'Save a form’s size and format rules once and apply them in one step.',
    limit: 'Settings only, stored in this browser',
    icon: <path {...stroke} d="M5 6h14M5 12h14M5 18h14M9 4v4M15 10v4M11 16v4" />,
  },
  {
    path: 'kit',
    title: 'Application kit',
    text: 'Gather your finished files, rename them, and download one ZIP.',
    limit: 'Temporary — cleared when the tab closes',
    icon: <path {...stroke} d="M4 8h16v11H4zM9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8M4 13h16M11 12h2v2h-2z" />,
  },
];

export function Home() {
  const kit = useKit();
  return (
    <div>
      <section className="flex items-center gap-4">
        <img src={ICON} alt="" width={1254} height={1254} className="-m-2 hidden h-24 w-24 shrink-0 object-contain sm:block" />
        <div>
          <p className="text-sm font-semibold text-brand">FormFit</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Documents ready. Applications easier.</h1>
          <p className="mt-2 max-w-2xl text-sm text-navy-600 sm:text-base">
            Prepare photos, signatures and PDFs to match the requirements of job, college, exam and other online forms.
          </p>
        </div>
      </section>
      <PrivacyNote className="mt-4 rounded-lg border border-navy-200 bg-white px-3 py-2.5" />

      <h2 className="sr-only">Tools</h2>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map((tool) => (
          <li key={tool.path}>
            <a
              href={href(tool.path)}
              className="group flex h-full gap-3 rounded-xl border border-navy-200 bg-white p-4 transition-colors hover:border-brand sm:flex-col"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-brand">
                <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
                  {tool.icon}
                </svg>
              </span>
              <span className="block">
                <span className="flex items-center gap-2 text-base font-semibold text-ink group-hover:text-brand">
                  {tool.title}
                  {tool.path === 'kit' && kit.items.length > 0 && (
                    <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">{kit.items.length}</span>
                  )}
                </span>
                <span className="mt-1 block text-sm text-navy-600">{tool.text}</span>
                <span className="mt-2 block text-xs text-navy-500">{tool.limit}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
