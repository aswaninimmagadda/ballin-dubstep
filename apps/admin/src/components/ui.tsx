import type { ReactNode } from 'react';
import Link from 'next/link';

/** Small server-friendly design system: consistent, large touch targets. */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  tone = 'default',
  href,
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  href?: string;
}) {
  const tones = {
    default: 'text-slate-900',
    success: 'text-green-700',
    warning: 'text-amber-600',
    danger: 'text-red-600',
  } as const;
  const body = (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{value}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Badge({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';
}) {
  const tones = {
    default: 'bg-slate-100 text-slate-700',
    success: 'bg-green-100 text-green-800',
    warning: 'bg-amber-100 text-amber-800',
    danger: 'bg-red-100 text-red-800',
    info: 'bg-blue-100 text-blue-800',
    muted: 'bg-slate-100 text-slate-500',
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function statusTone(
  status: string,
): 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'default' {
  switch (status) {
    case 'active':
      return 'success';
    case 'expiring_soon':
    case 'grace_period':
    case 'frozen':
    case 'pending_activation':
    case 'pending':
      return 'warning';
    case 'expired':
    case 'cancelled':
    case 'suspended':
      return 'danger';
    case 'trial':
    case 'lead':
      return 'info';
    case 'archived':
      return 'muted';
    default:
      return 'default';
  }
}

export function Button({
  children,
  variant = 'primary',
  type = 'submit',
  href,
  className = '',
  ...rest
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  type?: 'submit' | 'button';
  href?: string;
  className?: string;
} & Record<string, unknown>) {
  const variants = {
    primary: 'bg-primary text-white hover:bg-primary-dark',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100',
  } as const;
  const cls = `btn inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 ${variants[variant]} ${className}`;
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  required,
  hint,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export const inputCls =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30';

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function ErrorBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {message}
    </div>
  );
}

export function SuccessBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
    >
      {message}
    </div>
  );
}
