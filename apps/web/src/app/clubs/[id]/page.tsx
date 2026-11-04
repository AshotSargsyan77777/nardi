'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { Avatar } from '@/components/Avatar';
import { Badge, Button, ErrorText, Loading, PageTitle, Panel } from '@/components/ui';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';

export default function ClubPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const router = useRouter();
  const me = useRequireAuth();
  const { data: c, error, mutate } = useSWR<any>(me ? `/clubs/${id}` : null);
  const [err, setErr] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  if (error) return <ErrorText error={error} />;
  if (!c || !me) return <Loading />;
  const owner = c.myRole === 'OWNER';
  const link = typeof window !== 'undefined' ? `${window.location.origin}/c/${c.inviteCode}` : '';
  const text = t('clubs.shareText', { name: c.name });
  const share = async () => {
    if (navigator.share) return navigator.share({ title: c.name, text, url: link }).catch(() => undefined);
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* blocked */ }
  };
  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); await mutate(); } catch (e) { setErr(e); } };
  const enc = encodeURIComponent;
  const online = (d: string | null) => !!d && Date.now() - new Date(d).getTime() < 5 * 60_000;
  return (
    <div className="space-y-5">
      <PageTitle sub={c.description || t('clubs.sub')} action={<Link href="/clubs"><Button size="sm">← {t('clubs.title')}</Button></Link>}>
        <span className="mr-2">{c.emblem}</span>{c.name}
      </PageTitle>
      <ErrorText error={err} />

      <Panel title={`📨 ${t('clubs.invite')}`}>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-lg bg-black/30 px-3 py-2 font-mono text-lg tracking-widest text-gold-200">{c.inviteCode}</code>
          <Button variant="gold" onClick={share}>📤 {copied ? t('clubs.copied') : t('invite.share')}</Button>
          <a className="rounded-xl bg-white/5 px-3 py-2 text-sm ring-1 ring-white/10" href={`https://wa.me/?text=${enc(`${text} ${link}`)}`} target="_blank" rel="noreferrer">WhatsApp</a>
          <a className="rounded-xl bg-white/5 px-3 py-2 text-sm ring-1 ring-white/10" href={`https://t.me/share/url?url=${enc(link)}&text=${enc(text)}`} target="_blank" rel="noreferrer">Telegram</a>
          <a className="rounded-xl bg-white/5 px-3 py-2 text-sm ring-1 ring-white/10" href={`viber://forward?text=${enc(`${text} ${link}`)}`}>Viber</a>
          {owner && <Button size="sm" onClick={() => run(() => api(`/clubs/${id}`, { method: 'PATCH', body: { newCode: true } }))}>↻ {t('clubs.newCode')}</Button>}
        </div>
        <p className="mt-2 text-xs text-white/45">{t('clubs.inviteHint')}</p>
      </Panel>

      <Panel title={`🏆 ${t('clubs.table')}`} action={<span className="text-xs text-white/45">{t('clubs.together', { n: c.matchesTogether })}</span>}>
        <p className="mb-3 text-xs text-white/45">{t('clubs.tableNote')}</p>
        <div className="overflow-x-auto">
          <table className="data">
            <thead><tr><th>#</th><th>{t('lb.player')}</th><th>{t('lb.points')}</th><th>{t('profile.wins')}</th><th>{t('profile.games')}</th><th>{t('profile.rating')}</th>{owner && <th />}</tr></thead>
            <tbody>
              {c.members.map((m: any) => (
                <tr key={m.userId}>
                  <td className={`font-bold ${m.rank <= 3 && m.points > 0 ? 'text-gold-300' : 'text-white/50'}`}>{m.rank <= 3 && m.points > 0 ? ['🥇', '🥈', '🥉'][m.rank - 1] : m.rank}</td>
                  <td>
                    <Link href={`/u/${m.nickname}`} className="flex items-center gap-2 font-semibold hover:underline">
                      <span className="relative"><Avatar name={m.avatar} size={28} />{online(m.lastSeenAt) && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-felt-500 ring-2 ring-ink-900" />}</span>
                      {m.nickname}{m.role === 'OWNER' && ' 👑'}{m.userId === me.id && <Badge color="green">{t('game.you')}</Badge>}
                    </Link>
                  </td>
                  <td><Badge color="gold">{m.points}</Badge></td><td>{m.wins}</td><td>{m.games}</td><td>{m.rating}</td>
                  {owner && <td>{m.userId !== me.id && <button className="text-xs text-ruby-400 hover:underline" onClick={() => confirm(t('clubs.kickConfirm', { name: m.nickname })) && run(() => api(`/clubs/${id}/members/${m.userId}`, { method: 'DELETE' }))}>{t('clubs.kick')}</button>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="flex flex-wrap gap-2">
        <Link href="/play/friends"><Button variant="emerald">🤝 {t('clubs.playTable')}</Button></Link>
        <Button variant="danger" onClick={() => confirm(t('clubs.leaveConfirm')) && run(async () => { await api(`/clubs/${id}/leave`, { method: 'POST' }); router.push('/clubs'); })}>{t('clubs.leave')}</Button>
      </div>
    </div>
  );
}
