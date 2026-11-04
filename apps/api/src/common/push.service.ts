import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import webpush from 'web-push';
import { PrismaService } from './prisma.service';

type Kind = 'turn' | 'invite' | 'friendRequest' | 'friendAccepted' | 'matchFound' | 'tournamentMatch' | 'tournamentStart';
const TEXT: Record<string, Record<Kind, (x: string) => { title: string; body: string }>> = {
  hy: {
    turn: () => ({ title: 'Քո հերթն է', body: 'Սեղանի մոտ քեզ են սպասում' }),
    invite: (x) => ({ title: 'Կանչում են խաղի', body: `${x}-ը քեզ կանչում է իր սեղանի մոտ` }),
    friendRequest: (x) => ({ title: 'Ընկերության հայտ', body: `${x}-ը ուզում է ընկեր լինել` }),
    friendAccepted: (x) => ({ title: 'Նոր ընկեր', body: `${x}-ն ընդունեց հայտդ` }),
    matchFound: () => ({ title: 'Խաղը գտնվեց', body: 'Արագ հաստատիր, որ սկսենք' }),
    tournamentMatch: (x) => ({ title: 'Մրցաշար', body: `Քո խաղը ${x}-ի դեմ սկսվեց` }),
    tournamentStart: () => ({ title: 'Մրցաշարը սկսվում է', body: 'Մտիր կայք, քո առաջին խաղը հիմա կլինի' }),
  },
  ru: {
    turn: () => ({ title: 'Ваш ход', body: 'Вас ждут за столом' }),
    invite: (x) => ({ title: 'Зовут играть', body: `${x} зовёт вас за свой стол` }),
    friendRequest: (x) => ({ title: 'Заявка в друзья', body: `${x} хочет дружить` }),
    friendAccepted: (x) => ({ title: 'Новый друг', body: `${x} принял(а) заявку` }),
    matchFound: () => ({ title: 'Игра найдена', body: 'Подтвердите, чтобы начать' }),
    tournamentMatch: (x) => ({ title: 'Турнир', body: `Ваша игра против ${x} началась` }),
    tournamentStart: () => ({ title: 'Турнир начинается', body: 'Заходите — ваша первая игра сейчас' }),
  },
  en: {
    turn: () => ({ title: 'Your turn', body: 'They are waiting for you at the table' }),
    invite: (x) => ({ title: 'Game invite', body: `${x} invites you to their table` }),
    friendRequest: (x) => ({ title: 'Friend request', body: `${x} wants to be friends` }),
    friendAccepted: (x) => ({ title: 'New friend', body: `${x} accepted your request` }),
    matchFound: () => ({ title: 'Game found', body: 'Confirm quickly to start' }),
    tournamentMatch: (x) => ({ title: 'Tournament', body: `Your match against ${x} has started` }),
    tournamentStart: () => ({ title: 'Tournament starting', body: 'Come in — your first match is now' }),
  },
};

/**
 * Web Push to phones/browsers that opted in. VAPID keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY,
 * or are generated once and kept in the database, so it works without extra setup.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly log = new Logger(PushService.name);
  private publicKey: string | null = null;
  private lastSent = new Map<string, number>();

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    try {
      let keys = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY } : null;
      if (!keys) {
        const row = await this.prisma.platformSetting.findUnique({ where: { key: 'vapid' } });
        keys = (row?.value as any) ?? null;
        if (!keys?.publicKey) {
          keys = webpush.generateVAPIDKeys();
          await this.prisma.platformSetting.upsert({ where: { key: 'vapid' }, create: { key: 'vapid', value: keys as any }, update: { value: keys as any } });
        }
      }
      webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:support@example.com', keys!.publicKey, keys!.privateKey);
      this.publicKey = keys!.publicKey;
    } catch (e) {
      this.log.warn(`push disabled: ${(e as Error).message}`);
    }
  }

  vapidPublicKey() {
    return this.publicKey;
  }

  async subscribe(userId: string, s: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: s.endpoint },
      create: { userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth },
      update: { userId, p256dh: s.keys.p256dh, auth: s.keys.auth },
    });
    return { ok: true };
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
    return { ok: true };
  }

  /** Fire-and-forget; at most one message of the same kind per user every `everyMs`. */
  send(userId: string, kind: Kind, arg = '', url = '/', everyMs = 60_000) {
    if (!this.publicKey) return;
    const key = `${userId}:${kind}`;
    if (Date.now() - (this.lastSent.get(key) ?? 0) < everyMs) return;
    this.lastSent.set(key, Date.now());
    void this.deliver(userId, kind, arg, url).catch((e) => this.log.warn(`push failed: ${e?.message ?? e}`));
  }

  private async deliver(userId: string, kind: Kind, arg: string, url: string) {
    const [subs, u] = await Promise.all([
      this.prisma.pushSubscription.findMany({ where: { userId } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { locale: true, settings: true } }),
    ]);
    if (!subs.length || !u) return;
    // invitations and friends follow the «game invites» switch in the settings
    if (kind !== 'turn' && (u.settings as any)?.notifications?.matchInvites === false) return;
    const text = (TEXT[u.locale] ?? TEXT.hy)[kind](arg);
    const payload = JSON.stringify({ ...text, url, tag: kind });
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 120 });
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) await this.prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
      }
    }
  }
}
