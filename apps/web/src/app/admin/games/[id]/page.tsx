'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { Badge, Loading, PageTitle, Panel, StatusBadge } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

export default function AdminMatchDetail() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { data: m } = useSWR<any>(`/admin/matches/${id}`);
  const [filter, setFilter] = useState('');
  if (!m) return <Loading />;
  const events = m.events.filter((e: any) => !filter || e.type.includes(filter));
  return (
    <div className="space-y-5">
      <PageTitle sub={`${m.mode} · ${fmtDate(m.startedAt, locale)} · ${m.finishReason ?? ''}`} action={<StatusBadge status={m.status} />}>Match {m.id.slice(0, 8)}</PageTitle>
      <Panel>
        <div className="grid gap-2 text-sm sm:grid-cols-4">
          {m.players.sort((a: any, b: any) => a.seat - b.seat).map((p: any) => (
            <div key={p.seat} className="rounded-xl bg-black/25 p-2">
              <div className="font-semibold">{p.user?.nickname ?? p.botName} {p.isBot && <Badge>bot</Badge>}</div>
              <div className="text-xs text-white/50">{p.seat === 0 ? 'white' : 'black'} · {p.result ?? '—'} · {p.ratingBefore ?? ''}→{p.ratingAfter ?? ''}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-xs text-white/40">score {m.scoreTeam0}:{m.scoreTeam1} · version {m.version} · resultHash {m.resultHash ?? '—'}</p>
      </Panel>
      <Panel title={`${t('admin.events')} (${m.events.length})`} action={<input className="h-8 rounded-lg bg-black/30 px-2 text-xs ring-1 ring-white/10" placeholder="filter type" value={filter} onChange={(e) => setFilter(e.target.value)} />}>
        <div className="max-h-[60vh] overflow-y-auto font-mono text-[11px]">
          {events.map((e: any) => (
            <details key={e.id} className="border-b border-white/5 py-1">
              <summary className="cursor-pointer"><span className="text-white/40">#{e.seq}</span> <span className="text-gold-200">{e.type}</span> {e.seat !== null && <span className="text-white/50">seat {e.seat}</span>} <span className="text-white/30">{fmtDate(e.createdAt, locale)}</span></summary>
              <pre className="whitespace-pre-wrap break-all p-2 text-white/60">{JSON.stringify(e.payload, null, 1)}</pre>
            </details>
          ))}
        </div>
      </Panel>
    </div>
  );
}
