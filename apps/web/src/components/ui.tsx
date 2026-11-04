'use client';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { ButtonHTMLAttributes, ReactNode, useEffect } from 'react';
import { useApp } from '@/lib/app-state';
import { fmtNum } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

type Variant = 'gold' | 'emerald' | 'ghost' | 'danger' | 'subtle';
const VARIANTS: Record<Variant, string> = {
  gold: 'bg-gold-grad text-ink-950 shadow-glow hover:brightness-110',
  emerald: 'bg-gradient-to-b from-felt-500 to-felt-700 text-white shadow-soft hover:brightness-110 ring-1 ring-felt-500/50',
  ghost: 'bg-white/5 text-white ring-1 ring-white/10 hover:bg-white/10',
  danger: 'bg-ruby-600/90 text-white hover:bg-ruby-500',
  subtle: 'text-white/70 hover:text-white hover:bg-white/5',
};

export function Button({ variant = 'ghost', size = 'md', loading, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  const sz = size === 'lg' ? 'h-14 px-6 text-base' : size === 'sm' ? 'h-9 px-3 text-sm' : 'h-11 px-5 text-sm';
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${sz} ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function Panel({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-white/[0.07] bg-gradient-to-b from-ink-800/90 to-ink-900/90 p-4 shadow-soft backdrop-blur sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="font-display text-base font-bold text-white/90">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-white/50">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-white/40">{hint}</span>}
    </label>
  );
}

export const inputCls = 'h-11 w-full rounded-xl border border-white/10 bg-ink-950/60 px-3.5 text-white placeholder-white/30 outline-none transition focus:border-gold-400/60 focus:ring-2 focus:ring-gold-400/20';

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 py-2 text-left disabled:opacity-50">
      {label && <span className="text-sm text-white/80">{label}</span>}
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-felt-500' : 'bg-white/15'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${small ? 'h-4 w-4' : 'h-8 w-8 text-gold-400'}`} />;
}

export function Loading() {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-white/60">
      <Spinner /> {t('common.loading')}
    </div>
  );
}

export function Empty({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-sm text-white/40">{children ?? t('common.empty')}</div>;
}

const BADGE: Record<string, string> = {
  green: 'bg-felt-500/15 text-felt-500 ring-felt-500/30',
  gold: 'bg-gold-400/15 text-gold-300 ring-gold-400/30',
  red: 'bg-ruby-500/15 text-ruby-400 ring-ruby-500/30',
  gray: 'bg-white/5 text-white/60 ring-white/10',
  blue: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
};
export function Badge({ color = 'gray', children }: { color?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${BADGE[color]}`}>{children}</span>;
}

const STATUS_COLOR: Record<string, keyof typeof BADGE> = {
  PAID: 'green', COMPLETED: 'green', FINISHED: 'green', ACTIVE: 'blue', READY: 'green', PLAYING: 'blue', ANSWERED: 'green', APPROVED: 'blue',
  PENDING: 'gold', CREATED: 'gold', PENDING_REVIEW: 'gold', WAITING: 'gold', PROCESSING: 'blue', OPEN: 'gold',
  FAILED: 'red', REJECTED: 'red', CANCELLED: 'gray', REFUNDED: 'gray', BLOCKED: 'red', CLOSED: 'gray',
  WIN: 'green', LOSS: 'red', ABANDON: 'gray',
};
export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const label = t(`status.${status}`) !== `status.${status}` ? t(`status.${status}`) : t(`history.${status}`) !== `history.${status}` ? t(`history.${status}`) : status;
  return <Badge color={STATUS_COLOR[status] ?? 'gray'}>{label}</Badge>;
}

/** Amount with the configured currency symbol (names/symbols come from the admin panel). */
export function Coins({ amount, currency, signed = false, className = '' }: { amount: number; currency: 'BLOT' | 'FUN' | string; signed?: boolean; className?: string }) {
  const { config } = useApp();
  const { locale } = useI18n();
  const cur = config?.currencies.find((c) => c.code === currency);
  const sign = signed && amount > 0 ? '+' : '';
  const color = currency === 'BLOT' ? 'text-gold-300' : 'text-sky-300';
  return (
    <span className={`inline-flex items-baseline gap-1 font-semibold tabular-nums ${className}`}>
      <span className={signed ? (amount >= 0 ? 'text-felt-500' : 'text-ruby-400') : ''}>{sign}{fmtNum(amount, locale)}</span>
      <span className={`text-[0.75em] ${color}`}>{cur?.symbol ?? currency}</span>
    </span>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose?: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open || !onClose) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            className={`max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-ink-850 p-5 shadow-2xl sm:rounded-3xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            {title && <h3 className="mb-4 font-display text-lg font-bold">{title}</h3>}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function PageTitle({ children, sub, action }: { children: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{children}</h1>
        {sub && <p className="mt-1 text-sm text-white/50">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-center gap-3 text-sm">
      <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('common.prev')}</Button>
      <span className="text-white/50">{page} / {pages}</span>
      <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('common.next')}</Button>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  // a translated text for known server error codes, else the server's message
  const code = (error as { code?: string })?.code;
  const known = code ? t(`err.${code}`) : '';
  const msg = known && known !== `err.${code}` ? known : error instanceof Error ? error.message : String(error);
  return <p className="rounded-lg bg-ruby-500/10 px-3 py-2 text-sm text-ruby-400 ring-1 ring-ruby-500/20">{msg}</p>;
}

export function LinkCard({ href, onClick, disabled, title, sub, icon, accent = 'emerald' }: { href?: string; onClick?: () => void; disabled?: boolean; title: ReactNode; sub?: ReactNode; icon: ReactNode; accent?: 'emerald' | 'gold' | 'sky' | 'ruby' }) {
  const ring = { emerald: 'from-felt-600/30 ring-felt-500/30', gold: 'from-gold-500/25 ring-gold-400/30', sky: 'from-sky-500/20 ring-sky-400/25', ruby: 'from-ruby-500/20 ring-ruby-400/25' }[accent];
  const cls = `group flex min-h-[92px] w-full items-center gap-4 rounded-2xl bg-gradient-to-br ${ring} to-ink-850 p-4 text-left ring-1 transition hover:-translate-y-0.5 hover:shadow-soft disabled:opacity-60`;
  const inner = (
    <>
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-black/25 text-2xl">{icon}</span>
      <span>
        <span className="block font-display text-base font-bold">{title}</span>
        {sub && <span className="block text-xs text-white/55">{sub}</span>}
      </span>
    </>
  );
  if (href) return <Link href={href} className={cls}>{inner}</Link>;
  return <button type="button" onClick={onClick} disabled={disabled} className={cls}>{inner}</button>;
}
