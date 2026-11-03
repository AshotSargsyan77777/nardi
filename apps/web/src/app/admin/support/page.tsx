'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { Button, Empty, Loading, PageTitle, Panel, StatusBadge, inputCls } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

export default function AdminSupport() {
  const { t, locale } = useI18n();
  const { data, mutate } = useSWR<any[]>('/admin/tickets');
  const [replies, setReplies] = useState<Record<string, string>>({});
  if (!data) return <Loading />;
  return (
    <div>
      <PageTitle>{t('admin.tickets')}</PageTitle>
      <Panel>
        {!data.length ? <Empty /> : (
          <ul className="space-y-3">{data.map((tk) => (
            <li key={tk.id} className="rounded-xl bg-black/25 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><b>{tk.subject}</b><span className="flex items-center gap-2 text-xs text-white/50">{tk.user.nickname} · {tk.user.email} · {fmtDate(tk.createdAt, locale)} <StatusBadge status={tk.status} /></span></div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-white/70">{tk.message}</p>
              {tk.reply ? <p className="mt-2 rounded-lg bg-felt-900/50 p-2 text-sm">{tk.reply}</p> : (
                <div className="mt-2 flex gap-2">
                  <textarea className={`${inputCls} h-20 py-2`} value={replies[tk.id] ?? ''} onChange={(e) => setReplies({ ...replies, [tk.id]: e.target.value })} />
                  <Button variant="gold" disabled={!replies[tk.id]?.trim()} onClick={async () => { await api(`/admin/tickets/${tk.id}/reply`, { method: 'POST', body: { reply: replies[tk.id] } }); mutate(); }}>{t('admin.send')}</Button>
                </div>
              )}
            </li>
          ))}</ul>
        )}
      </Panel>
    </div>
  );
}
