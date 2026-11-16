import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark disabled:bg-navy-300',
  secondary: 'bg-white text-ink border border-navy-300 hover:bg-navy-100 disabled:text-navy-400',
  ghost: 'text-navy-700 hover:bg-navy-100 disabled:text-navy-400',
  danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50 disabled:text-navy-400',
};

export function Button({
  variant = 'secondary',
  small = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean }) {
  const size = small ? 'min-h-9 px-3 text-sm' : 'min-h-11 px-4 text-sm';
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${size} ${VARIANTS[variant]} ${className}`}
    />
  );
}

export const inputClass =
  'block w-full min-h-11 rounded-lg border border-navy-300 bg-white px-3 text-base text-ink placeholder:text-navy-400 focus:border-brand disabled:bg-navy-100 disabled:text-navy-500 sm:text-sm';

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-navy-500">{hint}</p>
      ) : null}
    </div>
  );
}

type Tone = 'info' | 'warning' | 'error' | 'success';

const TONES: Record<Tone, string> = {
  info: 'border-blue-200 bg-blue-50 text-navy-800',
  warning: 'border-amber-300 bg-amber-50 text-amber-950',
  error: 'border-red-200 bg-red-50 text-red-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-950',
};

export function Alert({ tone, title, children }: { tone: Tone; title?: string; children?: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${TONES[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-1 space-y-2' : 'space-y-2'}>{children}</div>}
    </div>
  );
}

export function Card({ title, step, children, className = '' }: { title?: string; step?: number; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-navy-200 bg-white p-4 sm:p-5 ${className}`}>
      {title && (
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-ink">
          {step !== undefined && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-100 text-xs font-semibold text-navy-700" aria-hidden="true">
              {step}
            </span>
          )}
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

/** Progress bar. Pass no value for work whose length is unknown. */
export function ProgressBar({ value, label }: { value?: number; label: string }) {
  return (
    <div>
      <p className="mb-1 text-sm text-navy-700" aria-live="polite">
        {label}
      </p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value === undefined ? undefined : Math.round(value)}
        className="h-2 overflow-hidden rounded-full bg-navy-100"
      >
        <div
          className={`h-full rounded-full bg-brand transition-[width] ${value === undefined ? 'w-1/3 animate-pulse' : ''}`}
          style={value === undefined ? undefined : { width: `${Math.max(2, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-navy-300 bg-navy-100 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`min-h-10 rounded-md px-3 text-sm font-medium transition-colors ${
            option.value === value ? 'bg-white text-ink shadow-sm' : 'text-navy-600 hover:text-ink'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({
  id,
  checked,
  onChange,
  disabled,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm text-ink">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-brand"
      />
      <span>{children}</span>
    </label>
  );
}

/** Label/value rows for sizes and dimensions. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-navy-500">{label}</dt>
          <dd className="font-medium text-ink tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CheckLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${ok ? 'bg-emerald-600' : 'bg-red-600'}`}
      >
        {ok ? '✓' : '✕'}
      </span>
      <span>
        <span className="sr-only">{ok ? 'Passed: ' : 'Failed: '}</span>
        {children}
      </span>
    </li>
  );
}
