import { nickSkeleton, nickScriptOk } from '../common/nickname';
import { hasProfanity } from '../common/profanity';
import { SettingsService } from '../settings/settings.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GameKind, kindOf } from '@nardi/engine';
import { AppError } from '../common/errors';
import { PrismaService, Tx } from '../common/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { NICK_RE } from '../auth/auth.service';

/** Cosmetic achievements — they never influence game rules, dealing or matchmaking odds. */
export const ACHIEVEMENTS: { code: string; icon: string }[] = [
  { code: 'FIRST_GAME', icon: '🎲' },
  { code: 'FIRST_WIN', icon: '🏆' },
  { code: 'TEN_WINS', icon: '🔥' },
  { code: 'FIFTY_GAMES', icon: '🎖️' },
  { code: 'MARS', icon: '💥' },
  { code: 'FRIENDS_TABLE', icon: '🤝' },
  { code: 'RATING_1400', icon: '⭐' },
  { code: 'RATING_1600', icon: '🌟' },
];

export const AVATARS = ['pomegranate', 'apricot', 'ararat', 'eagle', 'lion', 'grapes', 'sun', 'star', 'knight', 'queen', 'ace', 'jack'];

export const levelForXp = (xp: number) => Math.floor(Math.sqrt(xp / 100)) + 1;
export const xpForLevel = (level: number) => (level - 1) ** 2 * 100;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private ledger: LedgerService, private settings: SettingsService) {}

  /** Fill the look-alike skeleton for accounts created before it existed (or by scripts). */
  async onModuleInit() {
    for (;;) {
      const rows = await this.prisma.user.findMany({ where: { nicknameSkeleton: null }, select: { id: true, nickname: true }, take: 500 });
      if (!rows.length) break;
      for (const r of rows) await this.prisma.user.update({ where: { id: r.id }, data: { nicknameSkeleton: nickSkeleton(r.nickname) } });
    }
  }

  async me(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { achievements: true } });
    return {
      id: u.id, email: u.email, nickname: u.nickname, avatar: u.avatar, role: u.role, locale: u.locale,
      createdAt: u.createdAt, rating: u.rating, xp: u.xp, level: u.level,
      nextLevelXp: xpForLevel(u.level + 1), levelXp: xpForLevel(u.level),
      stats: { games: u.gamesPlayed, wins: u.wins, losses: u.losses, winRate: u.gamesPlayed ? Math.round((u.wins / u.gamesPlayed) * 1000) / 10 : 0 },
      balances: await this.ledger.balances(u.id),
      settings: u.settings, restrictions: u.restrictions, kycStatus: u.kycStatus,
      achievements: u.achievements.map((a) => ({ code: a.code, unlockedAt: a.unlockedAt })),
    };
  }

  /** Store a profile photo (data URL of a small JPEG/PNG/WebP) and point the avatar at it. */
  async setPhoto(userId: string, dataUrl: string) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) throw new AppError('BAD_PHOTO', 'Send a JPEG, PNG or WebP image');
    const data = Buffer.from(m[2], 'base64');
    if (data.length > 256 * 1024) throw new AppError('PHOTO_TOO_LARGE', 'The photo must be at most 256 KB');
    // trust the bytes, not the declared type
    const mime = data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      ? 'image/jpeg'
      : data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        ? 'image/png'
        : data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP'
          ? 'image/webp'
          : null;
    if (!mime) throw new AppError('BAD_PHOTO', 'Send a JPEG, PNG or WebP image');
    await this.prisma.$transaction(async (tx) => {
      await tx.avatarPhoto.deleteMany({ where: { userId } });
      const photo = await tx.avatarPhoto.create({ data: { userId, mime, data } });
      await tx.user.update({ where: { id: userId }, data: { avatar: `photo:${photo.id}` } });
    });
    return this.me(userId);
  }

  async removePhoto(userId: string) {
    await this.prisma.$transaction([
      this.prisma.avatarPhoto.deleteMany({ where: { userId } }),
      this.prisma.user.updateMany({ where: { id: userId, avatar: { startsWith: 'photo:' } }, data: { avatar: 'pomegranate' } }),
    ]);
    return this.me(userId);
  }

  async photo(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return this.prisma.avatarPhoto.findUnique({ where: { id }, select: { mime: true, data: true } });
  }

  async updateProfile(userId: string, d: { nickname?: string; avatar?: string; locale?: string }) {
    const data: Prisma.UserUpdateInput = {};
    if (d.nickname !== undefined) {
      const nick = d.nickname.trim();
      if (!NICK_RE.test(nick)) throw new AppError('BAD_NICKNAME', 'Nickname: 3-20 letters, digits, _ . -');
      if (!nickScriptOk(nick)) throw new AppError('BAD_NICKNAME', 'Use letters of one alphabet only (Armenian, Latin or Cyrillic)');
      if (hasProfanity(nick, (await this.settings.get('game')).chatFilter)) throw new AppError('BAD_NICKNAME', 'This nickname is not allowed');
      const skeleton = nickSkeleton(nick);
      const taken = await this.prisma.user.findFirst({ where: { OR: [{ nicknameLower: nick.toLowerCase() }, { nicknameSkeleton: skeleton }], NOT: { id: userId } } });
      if (taken) throw new AppError('NICKNAME_TAKEN', 'This nickname (or one that looks the same) is taken', 409);
      data.nickname = nick;
      data.nicknameLower = nick.toLowerCase();
      data.nicknameSkeleton = skeleton;
    }
    // an uploaded photo is changed only through /users/me/photo
    if (d.avatar !== undefined && !d.avatar.startsWith('photo:')) {
      if (!AVATARS.includes(d.avatar)) throw new AppError('BAD_AVATAR', 'Unknown avatar');
      data.avatar = d.avatar;
      // choosing a picture from the set drops an uploaded photo
      await this.prisma.avatarPhoto.deleteMany({ where: { userId } });
    }
    if (d.locale !== undefined) {
      if (!['hy', 'ru', 'en'].includes(d.locale)) throw new AppError('BAD_LOCALE', 'Unsupported language');
      data.locale = d.locale;
    }
    await this.prisma.user.update({ where: { id: userId }, data });
    return this.me(userId);
  }

  async updateSettings(userId: string, patch: { notifications?: Record<string, boolean>; privacy?: Record<string, boolean>; chatEnabled?: boolean }) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { settings: true } });
    const cur: any = u.settings ?? {};
    const pickBools = (src: any, keys: string[]) => Object.fromEntries(keys.filter((k) => typeof src?.[k] === 'boolean').map((k) => [k, src[k]]));
    const next = {
      notifications: { ...cur.notifications, ...pickBools(patch.notifications, ['matchInvites', 'payments', 'news']) },
      privacy: { ...cur.privacy, ...pickBools(patch.privacy, ['showProfile', 'showHistory', 'showOnLeaderboard']) },
      chatEnabled: typeof patch.chatEnabled === 'boolean' ? patch.chatEnabled : cur.chatEnabled ?? true,
    };
    await this.prisma.user.update({ where: { id: userId }, data: { settings: next } });
    return next;
  }

  /**
   * Detailed statistics from the last 200 finished matches (public game events only):
   * games won, mars won and suffered, doubles rolled, short and long nardi.
   */
  async stats(userId: string) {
    const seats = await this.prisma.matchPlayer.findMany({
      where: { userId, match: { status: 'FINISHED' } }, select: { matchId: true, seat: true, result: true, match: { select: { rules: true } } }, orderBy: { match: { startedAt: 'desc' } }, take: 200,
    });
    const seatOf = new Map(seats.map((s) => [s.matchId, s.seat]));
    const events = seats.length
      ? await this.prisma.matchEvent.findMany({ where: { matchId: { in: [...seatOf.keys()] }, type: { in: ['game_won', 'rolled'] } }, select: { matchId: true, type: true, payload: true } })
      : [];
    const st = { games: 0, gamesWon: 0, mars: 0, marsAgainst: 0, rolls: 0, doubles: 0, sheshBesh: 0 };
    for (const e of events) {
      const seat = seatOf.get(e.matchId)!;
      const p = e.payload as any;
      if (e.type === 'game_won' && p?.result) {
        st.games += 1;
        if (p.result.winner === seat) { st.gamesWon += 1; if (p.result.mars) st.mars += 1; }
        else if (p.result.mars) st.marsAgainst += 1;
      } else if (e.type === 'rolled' && p?.seat === seat && Array.isArray(p.dice)) {
        st.rolls += 1;
        if (p.dice[0] === p.dice[1]) st.doubles += 1;
        if (p.dice.includes(6) && p.dice.includes(5)) st.sheshBesh += 1;
      }
    }
    const by = (v: string) => seats.filter((x) => kindOf(x.match.rules) === v);
    const wins = (xs: typeof seats) => xs.filter((x) => x.result === 'WIN').length;
    return {
      matches: seats.length,
      shortMatches: by('short').length,
      shortWins: wins(by('short')),
      longMatches: by('long').length,
      longWins: wins(by('long')),
      checkersMatches: by('checkers').length,
      checkersWins: wins(by('checkers')),
      checkersDraws: by('checkers').filter((x) => x.result === 'DRAW').length,
      chessMatches: by('chess').length,
      chessWins: wins(by('chess')),
      chessDraws: by('chess').filter((x) => x.result === 'DRAW').length,
      games: st.games,
      gamesWonPct: st.games ? Math.round((st.gamesWon / st.games) * 100) : 0,
      mars: st.mars,
      marsAgainst: st.marsAgainst,
      rolls: st.rolls,
      doublesPct: st.rolls ? Math.round((st.doubles / st.rolls) * 100) : 0,
      sheshBesh: st.sheshBesh,
    };
  }

  /** 'friends' | 'sent' (I asked) | 'received' (they asked) | 'none' */
  private async friendship(me: string, other: string) {
    const f = await this.prisma.friendship.findFirst({ where: { OR: [{ requesterId: me, addresseeId: other }, { requesterId: other, addresseeId: me }] } });
    if (!f) return 'none';
    if (f.status === 'ACCEPTED') return 'friends';
    return f.requesterId === me ? 'sent' : 'received';
  }

  async publicProfile(nickname: string, viewerId?: string) {
    const u = await this.prisma.user.findUnique({ where: { nicknameLower: nickname.toLowerCase() }, include: { achievements: true } });
    if (!u || u.status !== 'ACTIVE') throw new AppError('NOT_FOUND', 'Player not found', 404);
    const privacy: any = (u.settings as any)?.privacy ?? {};
    const self = viewerId === u.id;
    const blocked = !!viewerId && !self && (await this.prisma.userBlock.count({ where: { userId: viewerId, blockedId: u.id } })) > 0;
    if (!self && privacy.showProfile === false) return { nickname: u.nickname, avatar: u.avatar, private: true, blocked };
    return {
      nickname: u.nickname, avatar: u.avatar, createdAt: u.createdAt, rating: u.rating, level: u.level,
      stats: { games: u.gamesPlayed, wins: u.wins, losses: u.losses, winRate: u.gamesPlayed ? Math.round((u.wins / u.gamesPlayed) * 1000) / 10 : 0 },
      achievements: u.achievements.map((a) => a.code),
      details: await this.stats(u.id),
      blocked,
      self,
      friendship: viewerId && !self ? await this.friendship(viewerId, u.id) : null,
      recentMatches: self || privacy.showHistory !== false ? (await this.matchHistory(u.id, 0, 5)).items : [],
      private: false,
    };
  }

  async matchHistory(userId: string, skip: number, take: number) {
    const where = { userId, match: { status: { in: ['FINISHED', 'CANCELLED'] as any } } };
    const [rows, total] = await Promise.all([
      this.prisma.matchPlayer.findMany({
        where, skip, take, orderBy: { match: { startedAt: 'desc' } },
        include: { match: { include: { players: { include: { user: { select: { nickname: true, avatar: true } } } } } } },
      }),
      this.prisma.matchPlayer.count({ where }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        matchId: r.matchId, mode: r.match.mode, status: r.match.status, startedAt: r.match.startedAt, finishedAt: r.match.finishedAt,
        durationSec: r.match.durationSec, stake: Number(r.match.stake), currency: r.match.currency,
        myTeam: r.team, result: r.result, scores: [r.match.scoreTeam0, r.match.scoreTeam1],
        ratingChange: r.ratingBefore !== null && r.ratingAfter !== null ? r.ratingAfter - r.ratingBefore : null,
        players: r.match.players.sort((a, b) => a.seat - b.seat).map((p) => ({ seat: p.seat, team: p.team, nickname: p.user?.nickname ?? p.botName, avatar: p.user?.avatar ?? 'bot', isBot: p.isBot })),
      })),
    };
  }

  async leaderboard(skip: number, take: number) {
    const where: Prisma.UserWhereInput = { status: 'ACTIVE', gamesPlayed: { gt: 0 }, NOT: { settings: { path: ['privacy', 'showOnLeaderboard'], equals: false } } };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, orderBy: [{ rating: 'desc' }, { wins: 'desc' }], skip, take, select: { nickname: true, avatar: true, rating: true, level: true, wins: true, gamesPlayed: true } }),
      this.prisma.user.count({ where }),
    ]);
    return { total, items: rows.map((r, i) => ({ rank: skip + i + 1, ...r, winRate: r.gamesPlayed ? Math.round((r.wins / r.gamesPlayed) * 1000) / 10 : 0 })) };
  }

  /**
   * Points table from finished matches (3 for a win, 1 for a played match; practice against bots
   * does not count, nor does a match for the player who walked out of it). `month`: this month only
   * (Yerevan time); `variant`: one game only (short / long nardi, checkers, chess).
   */
  async seasonLeaderboard(skip: number, take: number, opts: { month?: boolean; variant?: GameKind } = { month: true }) {
    const now = new Date(Date.now() + 4 * 3600_000);
    const since = opts.month ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 4 * 3600_000) : new Date(0);
    const variantSql = kindSql(opts.variant);
    const rows = await this.prisma.$queryRaw<{ userId: string; points: bigint; wins: bigint; games: bigint }[]>`
      SELECT mp."userId", SUM(CASE WHEN mp.result = 'WIN' THEN 3 ELSE 1 END) AS points,
             SUM(CASE WHEN mp.result = 'WIN' THEN 1 ELSE 0 END) AS wins, COUNT(*) AS games
      FROM "MatchPlayer" mp JOIN "Match" m ON m.id = mp."matchId" JOIN "User" u ON u.id = mp."userId"
      WHERE mp."userId" IS NOT NULL AND m.status = 'FINISHED' AND m.mode <> 'PRACTICE' AND m."finishedAt" >= ${since}
        AND NOT (COALESCE(m."finishReason", '') = 'forfeit' AND mp.result <> 'WIN') ${variantSql}
        AND u.status = 'ACTIVE' AND COALESCE(u.settings #>> '{privacy,showOnLeaderboard}', 'true') <> 'false'
      GROUP BY mp."userId" ORDER BY points DESC, wins DESC LIMIT ${take} OFFSET ${skip}`;
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, nickname: true, avatar: true, rating: true, level: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      season: opts.month ? now.toISOString().slice(0, 7) : null,
      variant: opts.variant ?? null,
      items: rows.map((r, i) => {
        const { id: _id, ...u } = byId.get(r.userId)!;
        return { rank: skip + i + 1, ...u, points: Number(r.points), wins: Number(r.wins), games: Number(r.games), winRate: Number(r.games) ? Math.round((Number(r.wins) / Number(r.games)) * 1000) / 10 : 0 };
      }),
    };
  }

  /** Called inside the match-finalisation transaction. */
  async grantAchievements(tx: Tx, userId: string, ctx: { mars: boolean; privateMatch: boolean }) {
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const earned: string[] = [];
    if (u.gamesPlayed >= 1) earned.push('FIRST_GAME');
    if (u.wins >= 1) earned.push('FIRST_WIN');
    if (u.wins >= 10) earned.push('TEN_WINS');
    if (u.gamesPlayed >= 50) earned.push('FIFTY_GAMES');
    if (ctx.mars) earned.push('MARS');
    if (ctx.privateMatch) earned.push('FRIENDS_TABLE');
    if (u.rating >= 1400) earned.push('RATING_1400');
    if (u.rating >= 1600) earned.push('RATING_1600');
    const have = new Set((await tx.userAchievement.findMany({ where: { userId }, select: { code: true } })).map((a) => a.code));
    const fresh = earned.filter((c) => !have.has(c));
    for (const code of fresh) await tx.userAchievement.create({ data: { userId, code } });
    for (const code of fresh) {
      await tx.notification.create({ data: { userId, type: 'achievement', title: 'achievement.unlocked', body: code, data: { code } } });
    }
    return fresh;
  }
}

/** SQL filter on Match `m` for one game kind (old nardi matches have no `game` in their rules). */
export function kindSql(kind?: GameKind | null) {
  switch (kind) {
    case 'short': return Prisma.sql`AND COALESCE(m.rules->>'game', 'nardi') = 'nardi' AND COALESCE(m.rules->>'variant', 'short') = 'short'`;
    case 'long': return Prisma.sql`AND COALESCE(m.rules->>'game', 'nardi') = 'nardi' AND m.rules->>'variant' = 'long'`;
    case 'checkers': return Prisma.sql`AND m.rules->>'game' = 'checkers'`;
    case 'chess': return Prisma.sql`AND m.rules->>'game' = 'chess'`;
    default: return Prisma.empty;
  }
}
