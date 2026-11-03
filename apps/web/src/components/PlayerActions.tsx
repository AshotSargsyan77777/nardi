'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';
import { Button, ErrorText, Field, Modal, inputCls } from './ui';

const REASONS = ['abuse', 'cheating', 'leaving', 'nickname', 'photo', 'other'] as const;

/** «Report» dialog: reason + optional details; goes to the support inbox. */
export function ReportDialog({ nickname, matchId, open, onClose }: { nickname: string; matchId?: string; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState<string>('abuse');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);
  const send = async () => {
    try {
      await api(`/users/profile/${encodeURIComponent(nickname)}/report`, { method: 'POST', body: { reason, details: details || undefined, matchId } });
      setSent(true);
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={`${t('player.report')}: ${nickname}`}>
      {sent ? (
        <div className="space-y-4"><p className="text-sm text-white/70">{t('player.reportSent')}</p><div className="flex justify-end"><Button onClick={onClose}>{t('common.close')}</Button></div></div>
      ) : (
        <div className="space-y-4">
          <Field label={t('player.reason')}>
            <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => <option key={r} value={r}>{t(`player.reason.${r}`)}</option>)}
            </select>
          </Field>
          <Field label={t('player.details')}><textarea className={`${inputCls} h-24`} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2"><Button variant="subtle" onClick={onClose}>{t('common.cancel')}</Button><Button variant="danger" onClick={send}>{t('player.report')}</Button></div>
        </div>
      )}
    </Modal>
  );
}

/** Block / unblock and report buttons for another player. */
export function PlayerActions({ nickname, blocked, onChange, matchId }: { nickname: string; blocked: boolean; onChange?: () => void; matchId?: string }) {
  const { t } = useI18n();
  const { me } = useApp();
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!me || me.nickname === nickname) return null;
  const toggle = async () => {
    setBusy(true);
    try {
      await api(`/users/profile/${encodeURIComponent(nickname)}/block`, { method: blocked ? 'DELETE' : 'POST' });
      onChange?.();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant={blocked ? 'ghost' : 'subtle'} loading={busy} onClick={toggle}>{blocked ? t('player.unblock') : `🚫 ${t('player.block')}`}</Button>
      <Button size="sm" variant="subtle" onClick={() => setReporting(true)}>⚑ {t('player.report')}</Button>
      {blocked && <p className="w-full text-xs text-white/40">{t('player.blockedNote')}</p>}
      <ReportDialog nickname={nickname} matchId={matchId} open={reporting} onClose={() => setReporting(false)} />
    </div>
  );
}
