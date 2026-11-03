'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { Badge, Loading, PageTitle, Pager, Panel, StatusBadge, inputCls } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

export default function AdminUsers() {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useSWR<any>(`/admin/users?page=${page}&pageSize=25${query ? `&q=${encodeURIComponent(query)}` : ''}`);
  return (
    <div>
      <PageTitle>{t('admin.users')}</PageTitle>
      <Panel>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(q); setPage(1); }} className="mb-4">
          <input className={inputCls} placeholder={`${t('common.search')}: email, nickname, id`} value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        {!data ? <Loading /> : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>{t('auth.nickname')}</th><th>{t('auth.email')}</th><th>{t('admin.role')}</th><th>{t('common.status')}</th><th>{t('profile.rating')}</th><th>{t('profile.games')}</th><th>KYC</th><th>{t('profile.memberSince')}</th></tr></thead>
              <tbody>
                {data.items.map((u: any) => (
                  <tr key={u.id}>
                    <td><Link href={`/admin/users/${u.id}`} className="font-semibold text-gold-200 hover:underline">{u.nickname}</Link></td>
                    <td className="text-white/60">{u.email}</td>
                    <td>{u.role !== 'USER' ? <Badge color="gold">{u.role}</Badge> : u.role}</td>
                    <td><StatusBadge status={u.status} /></td>
                    <td>{u.rating}</td><td>{u.gamesPlayed}</td><td className="text-xs">{u.kycStatus}</td>
                    <td className="whitespace-nowrap text-xs text-white/50">{fmtDate(u.createdAt, locale, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={page} total={data.total} pageSize={25} onPage={setPage} />}
      </Panel>
    </div>
  );
}
