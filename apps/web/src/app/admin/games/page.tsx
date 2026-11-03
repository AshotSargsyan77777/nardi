'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { JsonEditor, useReasonDialog } from '@/components/admin';
import { Badge, Button, Coins, Empty, Loading, PageTitle, Pager, Panel, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDate, fmtDuration } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

export default function AdminGames() {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, mutate } = useSWR<any>(`/admin/matches?page=${page}&pageSize=25${status ? `&status=${status}` : ''}`, { refreshInterval: 5000 });
  const { data: settings, mutate: ms } = useSWR<any>('/admin/settings');
  const { ask, dialog } = useReasonDialog();
  if (!data) return <Loading />;
  return (
    <div className="space-y-5">
      {dialog}
      <PageTitle>{t('admin.games')}</PageTitle>
      <Panel title={`🔴 ${t('admin.live')} (${data.live.length})`}>
        {!data.live.length ? <Empty /> : (
          <div className="overflow-x-auto"><table className="data"><thead><tr><th>ID</th><th>Mode</th><th>{t('history.players')}</th><th>Score</th><th>Hand</th><th>{t('game.stake')}</th><th /></tr></thead>
            <tbody>{data.live.map((m: any) => (
              <tr key={m.id}>
                <td><Link className="font-mono text-xs text-gold-200 hover:underline" href={`/admin/games/${m.id}`}>{m.id.slice(0, 8)}</Link></td>
                <td>{m.mode}</td>
                <td className="text-xs">{m.players.map((p: any) => <span key={p.seat} className={`mr-2 ${p.connected ? '' : 'text-ruby-400'}`}>{p.nickname}</span>)}</td>
                <td className="font-mono">{m.scores[0]}:{m.scores[1]}</td><td>{m.hand}</td>
                <td>{m.stake ? <Coins amount={m.stake} currency={m.currency} /> : '—'}</td>
                <td><Button size="sm" variant="danger" onClick={async () => { const r = await ask(t('admin.cancelMatch')); if (r) { await api(`/admin/matches/${m.id}/cancel`, { method: 'POST', body: { reason: r } }).catch((e) => alert(e.message)); mutate(); } }}>{t('admin.cancelMatch')}</Button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      <Panel title={t('history.title')} action={<div className="flex gap-1">{['', 'ACTIVE', 'FINISHED', 'CANCELLED'].map((s) => <Button key={s || 'all'} size="sm" variant={status === s ? 'gold' : 'ghost'} onClick={() => { setStatus(s); setPage(1); }}>{s || '∗'}</Button>)}</div>}>
        <div className="overflow-x-auto"><table className="data"><thead><tr><th>ID</th><th>{t('common.date')}</th><th>Mode</th><th>{t('history.players')}</th><th>Score</th><th>{t('history.duration')}</th><th>{t('common.status')}</th></tr></thead>
          <tbody>{data.items.map((m: any) => (
            <tr key={m.id}>
              <td><Link className="font-mono text-xs text-gold-200 hover:underline" href={`/admin/games/${m.id}`}>{m.id.slice(0, 8)}</Link></td>
              <td className="whitespace-nowrap text-xs">{fmtDate(m.startedAt, locale)}</td><td>{m.mode}</td>
              <td className="text-xs">{m.players.map((p: any) => p.user?.nickname ?? p.botName).join(', ')}</td>
              <td className="font-mono">{m.scoreTeam0}:{m.scoreTeam1}{m.winnerTeam !== null && <Badge color="green">T{m.winnerTeam + 1}</Badge>}</td>
              <td>{fmtDuration(m.durationSec)}</td><td><StatusBadge status={m.status} /></td>
            </tr>
          ))}</tbody>
        </table></div>
        <Pager page={page} total={data.total} pageSize={25} onPage={setPage} />
      </Panel>
      {settings && (
        <Panel title={t('admin.gameSettings')}>
          <JsonEditor key={JSON.stringify(settings.settings.game)} value={settings.settings.game} onSave={async (v) => { await api('/admin/settings/game', { method: 'PUT', body: v }); ms(); }} />
        </Panel>
      )}
    </div>
  );
}
