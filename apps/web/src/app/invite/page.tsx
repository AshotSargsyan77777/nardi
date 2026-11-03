'use client';
import { InviteFriends } from '@/components/InviteFriends';
import { Loading } from '@/components/ui';
import { useRequireAuth } from '@/lib/app-state';

export default function InvitePage() {
  const me = useRequireAuth();
  if (!me) return <Loading />;
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <InviteFriends />
    </div>
  );
}
