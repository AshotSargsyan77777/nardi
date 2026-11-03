'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { Button, ErrorText, Field, PageTitle, Panel, StatusBadge, inputCls } from '@/components/ui';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { fmtDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

export default function SupportPage() {
  const { t, locale } = useI18n();
  const { me, config } = useApp();
  const { data: tickets, mutate } = useSWR<any[]>(me ? '/support/tickets' : null);
  const [f, setF] = useState({ subject: '', message: '' });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api('/support/tickets', { method: 'POST', body: f });
      setF({ subject: '', message: '' });
      setSent(true);
      mutate();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageTitle sub={config?.legal.supportEmail}>{t('support.title')}</PageTitle>
      <Panel title={t('support.faq')}>
        <div className="divide-y divide-white/5">
          {[1, 2, 3, 4].map((n) => (
            <details key={n} className="group py-3">
              <summary className="cursor-pointer list-none font-semibold marker:hidden">
                <span className="mr-2 text-gold-300 group-open:rotate-90">›</span>{t(`faq.q${n}`)}
              </summary>
              <p className="mt-2 pl-5 text-sm text-white/65">{t(`faq.a${n}`)}</p>
            </details>
          ))}
        </div>
      </Panel>
      {me ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title={t('support.newTicket')}>
            <form onSubmit={submit} className="space-y-3">
              <Field label={t('support.subject')}><input className={inputCls} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} minLength={3} maxLength={120} required /></Field>
              <Field label={t('support.message')}><textarea className={`${inputCls} h-32 py-2`} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} minLength={10} maxLength={4000} required /></Field>
              <ErrorText error={error} />
              {sent && <p className="text-sm text-felt-500">{t('support.sent')}</p>}
              <Button variant="gold">{t('support.send')}</Button>
            </form>
          </Panel>
          <Panel title={t('support.myTickets')}>
            <ul className="space-y-2">
              {tickets?.map((tk) => (
                <li key={tk.id} className="rounded-xl bg-black/20 p-3 text-sm">
                  <div className="flex items-center justify-between"><b>{tk.subject}</b><StatusBadge status={tk.status} /></div>
                  <div className="text-[11px] text-white/40">{fmtDate(tk.createdAt, locale)}</div>
                  <p className="mt-1 whitespace-pre-wrap text-white/60">{tk.message}</p>
                  {tk.reply && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-felt-900/50 p-2 text-white/80"><b>{t('support.reply')}:</b> {tk.reply}</p>}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
