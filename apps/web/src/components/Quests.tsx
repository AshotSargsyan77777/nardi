'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';
import { Button, Coins, Modal, Panel } from './ui';

interface QuestView { id: string; target: number; reward: number; progress: number; done: boolean; claimed: boolean }
interface QuestsState { day: string; quests: QuestView[]; allDone: { reward: number; done: boolean; claimed: boolean }; weekly: QuestView }

export function useQuests() {
  const { me } = useApp();
  return useSWR<QuestsState>(me ? '/quests' : null, { refreshInterval: 60_000 });
}

/** Rewards waiting to be claimed (daily, all-done bonus, weekly). */
export const readyCount = (d: QuestsState) =>
  d.quests.filter((q) => q.done && !q.claimed).length + (d.allDone.done && !d.allDone.claimed ? 1 : 0) + (d.weekly.done && !d.weekly.claimed ? 1 : 0);

/** Today's three quests with progress bars and «Ստանալ» buttons. */
export function QuestsList() {
  const { t } = useI18n();
  const { refreshMe } = useApp();
  const { data, mutate } = useQuests();
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return null;
  const claim = async (id: string) => {
    setBusy(id);
    try {
      await mutate(await api(`/quests/${id}/claim`, { method: 'POST' }), false);
      refreshMe();
    } finally {
      setBusy(null);
    }
  };
  const ClaimButton = ({ id, done, claimed }: { id: string; done: boolean; claimed: boolean }) =>
    claimed ? <span className="w-[74px] text-center text-xs text-felt-500">✓ {t('quest.claimed')}</span> : (
      <Button size="sm" variant="gold" disabled={!done} loading={busy === id} className="w-[74px]" onClick={() => claim(id)}>{t('home.claim')}</Button>
    );
  return (
    <div className="space-y-3">
    <ul className="space-y-2.5">
      {data.quests.map((q) => (
        <li key={q.id} className="rounded-xl bg-black/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{t(`quest.${q.id}`)}</span>
            <Coins amount={q.reward} currency="FUN" className="text-xs" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${q.done ? 'bg-felt-500' : 'bg-gold-grad'}`} style={{ width: `${(q.progress / q.target) * 100}%` }} /></div>
            <span className="w-10 text-right text-xs tabular-nums text-white/50">{q.progress}/{q.target}</span>
            <ClaimButton id={q.id} done={q.done} claimed={q.claimed} />
          </div>
        </li>
      ))}
    </ul>
    <div className="flex items-center justify-between gap-2 rounded-xl bg-gold-400/10 p-3 ring-1 ring-gold-400/25">
      <span className="text-sm font-semibold">🏅 {t('quest.allDone')} <span className="ml-1"><Coins amount={data.allDone.reward} currency="FUN" className="text-xs" /></span></span>
      <ClaimButton id="all" done={data.allDone.done} claimed={data.allDone.claimed} />
    </div>
    <div className="rounded-xl bg-sky-500/10 p-3 ring-1 ring-sky-400/25">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">📅 {t('quest.weekly')}: {t(`quest.${data.weekly.id}`)}</span>
        <Coins amount={data.weekly.reward} currency="FUN" className="text-xs" />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${data.weekly.done ? 'bg-felt-500' : 'bg-sky-400'}`} style={{ width: `${(data.weekly.progress / data.weekly.target) * 100}%` }} /></div>
        <span className="w-12 text-right text-xs tabular-nums text-white/50">{data.weekly.progress}/{data.weekly.target}</span>
        <ClaimButton id={data.weekly.id} done={data.weekly.done} claimed={data.weekly.claimed} />
      </div>
    </div>
    </div>
  );
}

export function QuestsPanel() {
  const { t } = useI18n();
  return <Panel title={`📋 ${t('quest.title')}`}><QuestsList /></Panel>;
}

/** Lobby chip: shows how many rewards are waiting; opens the list. */
export function QuestsChip() {
  const { t } = useI18n();
  const { data } = useQuests();
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const ready = readyCount(data);
  const left = data.quests.filter((q) => !q.claimed).length;
  return (
    <>
      <button onClick={() => setOpen(true)} className={`rounded-full px-4 py-1.5 text-sm font-bold ring-1 ${ready ? 'bg-gold-400/20 text-gold-200 ring-gold-400/50' : 'bg-white/5 text-white/70 ring-white/10'}`}>
        📋 {t('quest.title')} {ready ? `· ${ready} 🎁` : left ? `· ${left}` : '✓'}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`📋 ${t('quest.title')}`}>
        <QuestsList />
        <p className="mt-3 text-xs text-white/40">{t('quest.note')}</p>
      </Modal>
    </>
  );
}
