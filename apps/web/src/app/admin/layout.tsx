'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Loading } from '@/components/ui';
import { useRequireAuth } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const me = useRequireAuth();
  const path = usePathname();
  if (!me) return <Loading />;
  if (me.role === 'USER') return <p className="py-20 text-center text-white/50">403</p>;
  const items = [
    ['/admin', '📊', t('admin.dashboard')], ['/admin/users', '👥', t('admin.users')], ['/admin/economy', '◉', t('admin.economy')],
    ['/admin/games', '🎲', t('admin.games')], ['/admin/tournaments', '🏟️', t('admin.tournaments')], ['/admin/monitoring', '🛡️', t('admin.monitoring')],
    ['/admin/platform', '⚙️', t('admin.platform')], ['/admin/support', '💬', t('admin.support')],
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
      <aside className="scrollbar-thin -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:block lg:space-y-1 lg:px-0">
        <div className="mb-3 hidden px-3 text-xs font-bold uppercase tracking-widest text-gold-300 lg:block">{t('admin.title')}</div>
        {items.map(([href, icon, label]) => {
          const active = href === '/admin' ? path === '/admin' : path?.startsWith(href);
          return (
            <Link key={href} href={href} className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${active ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'}`}>
              <span>{icon}</span>{label}
            </Link>
          );
        })}
        <div className="hidden px-3 pt-4 text-[11px] text-white/30 lg:block">{me.nickname} · {me.role}</div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
