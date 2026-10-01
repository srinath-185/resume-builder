import clsx from 'clsx';
import { Loader2, X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const BUTTON_VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/60',
  secondary: 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/60',
  ghost: 'text-slate-700 hover:bg-slate-100',
};

export function Button({ variant = 'primary', loading = false, className, children, icon: Icon, ...props }) {
  return (
    <button
      type="button"
      className={clsx('inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed', BUTTON_VARIANTS[variant], className)}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon ? <Icon className="size-4" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Field({ label, error, hint, children, htmlFor }) {
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

const INPUT = 'block w-full rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-500';

export function Input({ className, ...props }) {
  return <input className={clsx(INPUT, className)} {...props} />;
}

export function TextArea({ className, rows = 4, ...props }) {
  return <textarea rows={rows} className={clsx(INPUT, className)} {...props} />;
}

export function Select({ className, children, ...props }) {
  return (
    <select className={clsx(INPUT, className)} {...props}>
      {children}
    </select>
  );
}

export function Card({ title, actions, className, children }) {
  return (
    <section className={clsx('rounded-lg bg-white shadow-sm ring-1 ring-slate-200', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const BADGE_TONES = {
  gray: 'bg-slate-100 text-slate-700',
  blue: 'bg-brand-50 text-brand-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-red-50 text-red-700',
};

export function Badge({ tone = 'gray', children }) {
  return <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', BADGE_TONES[tone])}>{children}</span>;
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-600">{children}</div>}
    </div>
  );
}

export function Spinner({ label }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-slate-500" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label ?? t('common.loading', 'Loading…')}
    </div>
  );
}

export function Alert({ tone = 'blue', title, children }) {
  const tones = {
    blue: 'bg-brand-50 text-brand-700 ring-brand-100',
    amber: 'bg-amber-50 text-amber-900 ring-amber-200',
    red: 'bg-red-50 text-red-800 ring-red-200',
    green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  };
  return (
    <div className={clsx('rounded-md p-3 text-sm ring-1', tones[tone])} role={tone === 'red' ? 'alert' : 'status'}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
    </div>
  );
}

/** Shows an API error by its stable code; falls back to the server message. */
export function ErrorMessage({ error }) {
  const { t } = useTranslation('errors');
  if (!error) return null;
  const message = t(error.code ?? 'INTERNAL_ERROR', { defaultValue: error.message ?? t('INTERNAL_ERROR') });
  const details = Array.isArray(error.details) ? error.details : [];
  return (
    <Alert tone="red" title={message}>
      {details.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5">
          {details.slice(0, 10).map((detail, index) => (
            <li key={index}>{typeof detail === 'string' ? detail : detail.message ?? detail.value ?? JSON.stringify(detail)}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

export function Modal({ open, title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = event => event.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16" role="dialog" aria-modal="true" aria-label={title}>
      <div className={clsx('w-full rounded-lg bg-white shadow-xl', wide ? 'max-w-4xl' : 'max-w-lg')}>
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <div className="p-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={clsx(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
            active === tab.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900',
          )}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
