'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { MatchList } from '@/components/MatchList';
import { Loading, PageTitle, Pager, Panel } from '@/components/ui';
import { useRequireAuth } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';

export default function HistoryPage() {
  const { t } = useI18n();
  const me = useRequireAuth();
  const [page, setPage] = useState(1);
  const { data } = useSWR<any>(me ? `/users/me/matches?page=${page}&pageSize=20` : null);
  return (
    <div>
      <PageTitle>{t('history.title')}</PageTitle>
      <Panel>{!data ? <Loading /> : <><MatchList items={data.items} /><Pager page={page} total={data.total} pageSize={20} onPage={setPage} /></>}</Panel>
    </div>
  );
}
