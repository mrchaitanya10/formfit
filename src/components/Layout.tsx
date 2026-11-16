import type { ReactNode } from 'react';
import { href } from '../state/router';
import { useKit } from '../state/kit';

const LOGO = `${import.meta.env.BASE_URL}brand/formfit-logo.png`;
export const ICON = `${import.meta.env.BASE_URL}brand/formfit-icon.png`;

/**
 * The logo PNG (2172 × 724) has transparent padding: about 7% left and 19% top and bottom.
 * Negative margins trim that padding so the artwork lines up with the page edge.
 */
function Logo({ alt, className }: { alt: string; className: string }) {
  return <img src={LOGO} alt={alt} width={2172} height={724} className={`h-auto object-contain ${className}`} />;
}

export function PrivacyNote({ className = '' }: { className?: string }) {
  return (
    <p className={`flex items-start gap-2 text-sm text-navy-600 ${className}`}>
      <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 fill-emerald-600" aria-hidden="true">
        <path d="M10 1 3 4v5c0 4.4 2.9 8.4 7 10 4.1-1.6 7-5.6 7-10V4l-7-3Zm-1 12.4L5.6 10 7 8.6l2 2 4-4L14.4 8 9 13.4Z" />
      </svg>
      <span>Your files are processed on this device. Nothing is uploaded, and documents are cleared when you close the tab.</span>
    </p>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const kit = useKit();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-navy-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
          <a href={href('')} className="-ml-2.5 block shrink-0 rounded-lg sm:-ml-3.5">
            <Logo alt="FormFit" className="w-36 sm:w-48" />
          </a>
          <nav aria-label="Main" className="flex items-center gap-1 text-sm font-medium">
            <a href={href('')} className="hidden min-h-11 items-center rounded-lg px-3 text-navy-700 hover:bg-navy-100 sm:flex">
              Tools
            </a>
            <a href={href('presets')} className="flex min-h-11 items-center rounded-lg px-3 text-navy-700 hover:bg-navy-100">
              Presets
            </a>
            <a href={href('kit')} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-navy-700 hover:bg-navy-100">
              Kit
              <span
                className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${
                  kit.items.length ? 'bg-brand text-white' : 'bg-navy-100 text-navy-600'
                }`}
              >
                {kit.items.length}
                <span className="sr-only"> {kit.items.length === 1 ? 'item' : 'items'}</span>
              </span>
            </a>
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-8">
        {children}
      </main>

      <footer className="border-t border-navy-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Logo alt="FormFit" className="-my-2 -ml-2 w-32" />
            <p className="mt-1 text-sm text-navy-600">Documents ready. Applications easier.</p>
          </div>
          <div className="max-w-md space-y-1">
            <PrivacyNote />
            <p className="text-xs text-navy-500">File sizes use 1 KB = 1,000 bytes and 1 MB = 1,000,000 bytes.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Shared frame for a tool page: back link, title and one-line description. */
export function ToolPage({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <div>
      <a href={href('')} className="inline-flex min-h-9 items-center text-sm font-medium text-brand hover:underline">
        ← All tools
      </a>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-1 max-w-2xl text-sm text-navy-600">{intro}</p>
      <div className="mt-5 space-y-4">{children}</div>
    </div>
  );
}
