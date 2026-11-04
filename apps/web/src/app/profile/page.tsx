'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import useSWR from 'swr';
import { AVATAR_KEYS, Avatar } from '@/components/Avatar';
import { MatchList } from '@/components/MatchList';
import { StatsPanel } from '@/components/StatsPanel';
import { Button, ErrorText, Field, Loading, Modal, PageTitle, Panel, inputCls } from '@/components/ui';
import { api } from '@/lib/api';
import { squarePhoto } from '@/lib/photo';
import { useApp, useRequireAuth } from '@/lib/app-state';
import { fmtDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

const ACH_ICON: Record<string, string> = { FIRST_GAME: '🎲', FIRST_WIN: '🏆', TEN_WINS: '🔥', FIFTY_GAMES: '🎖️', MARS: '💥', FRIENDS_TABLE: '🤝', RATING_1400: '⭐', RATING_1600: '🌟' };

export default function ProfilePage() {
  const { t, locale } = useI18n();
  const me = useRequireAuth();
  const { refreshMe } = useApp();
  const [edit, setEdit] = useState(false);
  const [nick, setNick] = useState('');
  const [avatar, setAvatar] = useState('');
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { data: matches } = useSWR<any>(me ? '/users/me/matches?pageSize=10' : null);
  const { data: stats } = useSWR<any>(me ? '/users/me/stats' : null);
  if (!me) return <Loading />;
  const have = new Set(me.achievements.map((a) => a.code));
  const lvlPct = Math.min(100, Math.round(((me.xp - me.levelXp) / Math.max(1, me.nextLevelXp - me.levelXp)) * 100));
  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const updated = await api('/users/me/photo', { method: 'POST', body: { image: await squarePhoto(file) } });
      setAvatar(updated.avatar);
      await refreshMe();
    } catch (e) {
      setError(e);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const removePhoto = async () => {
    try {
      const updated = await api('/users/me/photo', { method: 'DELETE' });
      setAvatar(updated.avatar);
      await refreshMe();
    } catch (e) {
      setError(e);
    }
  };
  const save = async () => {
    try {
      await api('/users/me', { method: 'PATCH', body: { nickname: nick !== me.nickname ? nick : undefined, avatar: avatar.startsWith('photo:') ? undefined : avatar } });
      await refreshMe();
      setEdit(false);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="space-y-5">
      <PageTitle action={<div className="flex gap-2"><Button onClick={() => { setNick(me.nickname); setAvatar(me.avatar); setError(null); setEdit(true); }}>✏️ {t('profile.edit')}</Button><Link href="/profile/settings"><Button>⚙️ {t('nav.settings')}</Button></Link></div>}>
        {t('profile.title')}
      </PageTitle>
      <Panel>
        <div className="flex flex-col items-center gap-5 sm:flex-row">
          <Avatar name={me.avatar} size={96} ring="ring-4 ring-gold-400/40" />
          <div className="flex-1 text-center sm:text-left">
            <h2 className="font-display text-3xl font-extrabold">{me.nickname}</h2>
            <p className="text-sm text-white/50">{t('profile.memberSince')}: {fmtDate(me.createdAt, locale, false)}</p>
            <div className="mt-3 flex items-center justify-center gap-3 sm:justify-start">
              <span className="rounded-full bg-gold-400/15 px-3 py-1 text-sm font-bold text-gold-200">{t('profile.level')} {me.level}</span>
              <div className="h-2 w-48 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gold-grad" style={{ width: `${lvlPct}%` }} /></div>
              <span className="text-xs text-white/40">{me.xp}/{me.nextLevelXp} XP</span>
            </div>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[[t('profile.rating'), me.rating], [t('profile.games'), me.stats.games], [t('profile.wins'), me.stats.wins], [t('profile.losses'), me.stats.losses], [t('profile.winRate'), `${me.stats.winRate}%`]].map(([l, v]) => (
            <div key={String(l)} className="rounded-xl bg-black/25 p-3 text-center"><div className="font-display text-2xl font-extrabold">{v}</div><div className="text-xs text-white/45">{l}</div></div>
          ))}
        </div>
      </Panel>
      <Panel title={t('profile.achievements')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.keys(ACH_ICON).map((code) => (
            <div key={code} className={`flex items-center gap-3 rounded-xl p-3 ring-1 ${have.has(code) ? 'bg-gold-400/10 ring-gold-400/30' : 'bg-black/20 opacity-40 ring-white/5 grayscale'}`}>
              <span className="text-2xl">{ACH_ICON[code]}</span>
              <span className="text-sm font-semibold">{t(`ach.${code}`)}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-white/40">{t('profile.levelNote')}</p>
        <p className="mt-1 text-xs text-gold-200/80">🎁 {t('profile.nextReward', { level: me.level + 1, n: (me.level + 1) * 100 })}</p>
      </Panel>
      <StatsPanel s={stats} />
      <Panel title={t('nav.history')} action={<Link href="/history" className="text-xs text-gold-300 hover:underline">{t('common.seeAll')} →</Link>}>
        {!matches ? <Loading /> : <MatchList items={matches.items} />}
      </Panel>
      <Panel title={t('home.transactions')} action={<Link href="/wallet" className="text-xs text-gold-300 hover:underline">{t('nav.wallet')} →</Link>}>
        <p className="text-sm text-white/50">{t('wallet.history')}</p>
      </Panel>

      <Modal open={edit} onClose={() => setEdit(false)} title={t('profile.edit')}>
        <div className="space-y-4">
          <Field label={t('auth.nickname')}><input className={inputCls} value={nick} onChange={(e) => setNick(e.target.value)} maxLength={20} /></Field>
          <Field label={t('profile.avatar')}>
            <div className="mb-3 flex items-center gap-3">
              <Avatar name={avatar} size={64} ring="ring-2 ring-gold-400/60" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="gold" loading={uploading} onClick={() => fileRef.current?.click()}>📷 {t('profile.photoUpload')}</Button>
                {avatar.startsWith('photo:') && <Button size="sm" variant="subtle" onClick={removePhoto}>{t('profile.photoRemove')}</Button>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            </div>
            <div className="grid grid-cols-6 gap-2">
              {AVATAR_KEYS.map((a) => (
                <button key={a} onClick={() => setAvatar(a)} className={`rounded-full p-0.5 ${avatar === a ? 'ring-2 ring-gold-400' : ''}`}><Avatar name={a} size={44} /></button>
              ))}
            </div>
          </Field>
          <ErrorText error={error} />
          <div className="flex justify-end gap-2"><Button variant="subtle" onClick={() => setEdit(false)}>{t('common.cancel')}</Button><Button variant="gold" onClick={save}>{t('common.save')}</Button></div>
        </div>
      </Modal>
    </div>
  );
}
