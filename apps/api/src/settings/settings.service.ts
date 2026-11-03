import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { DEFAULT_RULES, RULE_LIMITS, RuleConfig, normalizeRules } from '@nardi/engine';
import { AuditService } from '../common/audit.service';
import { AppError } from '../common/errors';
import { DEFAULT_CHAT_FILTER } from '../common/profanity';
import { PrismaService } from '../common/prisma.service';
import { ENV, Env } from '../config/env';

/**
 * Owner-editable platform configuration. Nothing economic is hard-coded: all values live in
 * PlatformSetting rows, every change is appended to SettingChange and to the audit log.
 */
export interface Features {
  /** A = free entertainment (coins have no monetary value). B = money operations (requires legal approval). */
  platformMode: 'A' | 'B';
  purchasesEnabled: boolean;
  blotStakesEnabled: boolean;
  funStakesEnabled: boolean;
  withdrawalsEnabled: boolean;
  tournamentsEnabled: boolean;
  practiceBotsEnabled: boolean;
  /** Fill the casual random queue with labelled bots after N seconds (0 = never). */
  fillCasualWithBotsAfterSec: number;
  registrationOpen: boolean;
}

export interface Economy {
  signupBonus: { BLOT: number; FUN: number };
  dailyBonus: { FUN: number; belowBalance: number };
  limits: {
    purchaseMaxCoinsPerDay: number;
    stakeMin: number;
    stakeMax: number;
    withdrawalMinCoins: number;
    withdrawalMaxCoinsPerDay: number;
    refundWindowDays: number;
  };
  fees: { matchFeePercent: number; withdrawalFeePercent: number };
  /** «Invite a friend»: both get coins once the friend has finished `games` games; at most `monthlyCap` rewards a month per inviter. */
  referral: { inviter: number; friend: number; games: number; monthlyCap: number };
}

export interface GameSettings {
  defaultRules: RuleConfig;
  allowedTargetScores: number[];
  allowedTurnTimeouts: number[];
  stakeOptions: { FUN: number[]; BLOT: number[] };
  /** Which rule switches room hosts may change. */
  hostEditableRules: (keyof RuleConfig)[];
  /** Quick phrases and emojis players can send at the table (edited by admins). */
  emotes: Emotes;
  /** Words hidden in chat and refused in nicknames (any case, with spaces or look-alike letters). */
  chatFilter: string[];
}

export interface EmotePhrase { id: string; group: 'play' | 'general'; hy: string; ru: string; en: string }
export interface Emotes { phrases: EmotePhrase[]; emojis: string[] }

export const DEFAULT_EMOTES: Emotes = {
  phrases: [
    { id: 'zar', group: 'play', hy: 'Զառը գցի', ru: 'Бросай кости', en: 'Roll the dice' },
    { id: 'gele', group: 'play', hy: 'Գելե՜', ru: 'Дубль!', en: 'Doubles!' },
    { id: 'shesh_besh', group: 'play', hy: 'Շեշ-բեշ', ru: 'Шеш-беш', en: 'Six-five' },
    { id: 'mars', group: 'play', hy: 'Մարս ես լինում', ru: 'Будет марс', en: "You're getting a mars" },
    { id: 'bakht', group: 'play', hy: 'Բախտդ բերեց', ru: 'Повезло тебе', en: 'Lucky you' },
    { id: 'wow', group: 'play', hy: 'Ինչ խաղացիր ա՜', ru: 'Вот это ход!', en: 'What a move!' },
    { id: 'barev', group: 'general', hy: 'Բարև 👋', ru: 'Привет 👋', en: 'Hi 👋' },
    { id: 'apres', group: 'general', hy: 'Ապրես', ru: 'Молодец', en: 'Well done' },
    { id: 'vay', group: 'general', hy: 'Վայ…', ru: 'Ой…', en: 'Oops…' },
    { id: 'arag', group: 'general', hy: 'Արագ խաղա', ru: 'Быстрее', en: 'Hurry up' },
    { id: 'shnorh', group: 'general', hy: 'Շնորհակալ եմ', ru: 'Спасибо', en: 'Thanks' },
    { id: 'mek_el', group: 'general', hy: 'Մի հատ էլ խաղանք', ru: 'Сыграем ещё?', en: 'One more game?' },
  ],
  emojis: ['😂', '👏', '😎', '😡', '😢', '🤔', '🔥', '🙏'],
};

export interface LegalSettings { minAge: number; termsVersion: string; supportEmail: string }

export interface SettingsShape {
  features: Features;
  economy: Economy;
  game: GameSettings;
  legal: LegalSettings;
}

export const DEFAULT_SETTINGS: SettingsShape = {
  features: {
    platformMode: 'A',
    purchasesEnabled: false,
    blotStakesEnabled: false,
    funStakesEnabled: true,
    withdrawalsEnabled: false,
    tournamentsEnabled: false,
    practiceBotsEnabled: true,
    fillCasualWithBotsAfterSec: 0,
    registrationOpen: true,
  },
  economy: {
    signupBonus: { BLOT: 0, FUN: 10000 },
    dailyBonus: { FUN: 2000, belowBalance: 1000 },
    limits: { purchaseMaxCoinsPerDay: 50000, stakeMin: 10, stakeMax: 10000, withdrawalMinCoins: 1000, withdrawalMaxCoinsPerDay: 50000, refundWindowDays: 14 },
    fees: { matchFeePercent: 0, withdrawalFeePercent: 0 },
    referral: { inviter: 2000, friend: 1000, games: 3, monthlyCap: 10 },
  },
  game: {
    defaultRules: { ...DEFAULT_RULES },
    allowedTargetScores: [...RULE_LIMITS.targetScore],
    allowedTurnTimeouts: [30, 45, 60, 90],
    stakeOptions: { FUN: [0, 100, 500, 1000, 5000], BLOT: [] },
    hostEditableRules: ['variant', 'targetScore', 'turnTimeoutSec', 'marsEnabled', 'botLevel'],
    emotes: structuredClone(DEFAULT_EMOTES),
    chatFilter: [...DEFAULT_CHAT_FILTER],
  },
  legal: { minAge: 18, termsVersion: '1.0', supportEmail: 'support@example.com' },
};

type Key = keyof SettingsShape;

@Injectable()
export class SettingsService implements OnModuleInit {
  private cache: SettingsShape = structuredClone(DEFAULT_SETTINGS);
  private loadedAt = 0;

  constructor(private prisma: PrismaService, private audit: AuditService, @Inject(ENV) private env: Env) {}

  async onModuleInit() {
    await this.reload();
  }

  async reload() {
    const rows = await this.prisma.platformSetting.findMany();
    const next = structuredClone(DEFAULT_SETTINGS);
    for (const r of rows) if (r.key in next) (next as any)[r.key] = { ...(next as any)[r.key], ...(r.value as any) };
    next.economy.referral = { ...DEFAULT_SETTINGS.economy.referral, ...(next.economy.referral ?? {}) };
    // settings saved before a rule existed: fill in the new rule defaults and let hosts choose the deal style
    try {
      next.game.defaultRules = normalizeRules({ ...DEFAULT_RULES, ...next.game.defaultRules });
    } catch {
      next.game.defaultRules = { ...DEFAULT_RULES };
    }
    for (const k of ['variant', 'botLevel'] as const) if (!next.game.hostEditableRules.includes(k)) next.game.hostEditableRules = [...next.game.hostEditableRules, k];
    next.game.hostEditableRules = next.game.hostEditableRules.filter((k) => k in DEFAULT_RULES);
    if (!next.game.emotes?.phrases) next.game.emotes = structuredClone(DEFAULT_EMOTES);
    if (!Array.isArray(next.game.chatFilter)) next.game.chatFilter = [...DEFAULT_CHAT_FILTER];
    this.cache = next;
    this.loadedAt = Date.now();
  }

  async all(): Promise<SettingsShape> {
    if (Date.now() - this.loadedAt > 5000) await this.reload();
    return this.cache;
  }
  async get<K extends Key>(k: K): Promise<SettingsShape[K]> {
    return (await this.all())[k];
  }

  /** Feature flags after applying the environment's legal gate. */
  async effectiveFeatures(): Promise<Features & { moneyModeApproved: boolean }> {
    const f = await this.get('features');
    // no real-money features: coins are free practice chips
    const moneyOk = false;
    return {
      ...f,
      platformMode: moneyOk ? 'B' : 'A',
      withdrawalsEnabled: moneyOk && f.withdrawalsEnabled,
      purchasesEnabled: false,
      blotStakesEnabled: false,
      moneyModeApproved: this.env.legalMoneyModeApproved,
    };
  }

  validate<K extends Key>(key: K, value: any): SettingsShape[K] {
    const merged = { ...(DEFAULT_SETTINGS as any)[key], ...value };
    const nonNeg = (n: any, name: string) => {
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw new AppError('BAD_SETTING', `${name} must be a non-negative number`);
    };
    switch (key) {
      case 'features':
        if (!['A', 'B'].includes(merged.platformMode)) throw new AppError('BAD_SETTING', 'platformMode must be A or B');
        if (merged.platformMode === 'B' && !this.env.legalMoneyModeApproved) {
          throw new AppError('LEGAL_GATE', 'Mode B requires LEGAL_MONEY_MODE_APPROVED=true on the server (legal sign-off)');
        }
        if (merged.withdrawalsEnabled && merged.platformMode !== 'B') throw new AppError('LEGAL_GATE', 'Withdrawals are only available in mode B');
        for (const k of ['purchasesEnabled', 'blotStakesEnabled', 'funStakesEnabled', 'withdrawalsEnabled', 'tournamentsEnabled', 'practiceBotsEnabled', 'registrationOpen']) {
          if (typeof merged[k] !== 'boolean') throw new AppError('BAD_SETTING', `${k} must be boolean`);
        }
        nonNeg(merged.fillCasualWithBotsAfterSec, 'fillCasualWithBotsAfterSec');
        break;
      case 'economy':
        nonNeg(merged.signupBonus?.BLOT, 'signupBonus.BLOT');
        nonNeg(merged.signupBonus?.FUN, 'signupBonus.FUN');
        nonNeg(merged.dailyBonus?.FUN, 'dailyBonus.FUN');
        for (const [k, v] of Object.entries(merged.limits ?? {})) nonNeg(v, `limits.${k}`);
        for (const [k, v] of Object.entries(merged.fees ?? {})) {
          nonNeg(v, `fees.${k}`);
          if ((v as number) > 50) throw new AppError('BAD_SETTING', `fees.${k} cannot exceed 50%`);
        }
        for (const k of ['inviter', 'friend', 'games', 'monthlyCap'] as const) nonNeg(merged.referral?.[k], `referral.${k}`);
        if (merged.referral.games < 1 || merged.referral.games > 50) throw new AppError('BAD_SETTING', 'referral.games must be 1..50');
        if (merged.limits.stakeMin > merged.limits.stakeMax) throw new AppError('BAD_SETTING', 'stakeMin > stakeMax');
        break;
      case 'game':
        merged.defaultRules = normalizeRules(merged.defaultRules);
        merged.emotes = merged.emotes ?? structuredClone(DEFAULT_EMOTES);
        {
          const e = merged.emotes;
          const str = (v: any, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
          if (!Array.isArray(e.phrases) || e.phrases.length > 40) throw new AppError('BAD_SETTING', 'emotes.phrases: up to 40 items');
          const ids = new Set<string>();
          for (const p of e.phrases) {
            if (!p || !/^[a-z0-9_]{1,24}$/.test(p.id) || ids.has(p.id)) throw new AppError('BAD_SETTING', 'emotes.phrases[].id: unique, a-z 0-9 _');
            ids.add(p.id);
            if (!['play', 'general'].includes(p.group)) throw new AppError('BAD_SETTING', 'emotes.phrases[].group: play | general');
            for (const l of ['hy', 'ru', 'en']) if (!str(p[l], 40)) throw new AppError('BAD_SETTING', `emotes.phrases[].${l}: 1–40 characters`);
          }
          if (!Array.isArray(e.emojis) || e.emojis.length > 16 || !e.emojis.every((x: any) => str(x, 8))) throw new AppError('BAD_SETTING', 'emotes.emojis: up to 16 emojis');
        }
        merged.chatFilter = merged.chatFilter ?? [...DEFAULT_CHAT_FILTER];
        if (!Array.isArray(merged.chatFilter) || merged.chatFilter.length > 500 || !merged.chatFilter.every((w: any) => typeof w === 'string' && w.trim().length >= 2 && w.length <= 30)) {
          throw new AppError('BAD_SETTING', 'chatFilter: up to 500 words of 2–30 characters');
        }
        if (!Array.isArray(merged.allowedTargetScores) || !merged.allowedTargetScores.length) throw new AppError('BAD_SETTING', 'allowedTargetScores required');
        for (const c of ['FUN', 'BLOT']) {
          if (!Array.isArray(merged.stakeOptions?.[c])) throw new AppError('BAD_SETTING', `stakeOptions.${c} must be an array`);
          merged.stakeOptions[c].forEach((n: any) => nonNeg(n, `stakeOptions.${c}`));
        }
        break;
      case 'legal':
        if (!Number.isInteger(merged.minAge) || merged.minAge < 16 || merged.minAge > 25) throw new AppError('BAD_SETTING', 'minAge must be 16..25');
        break;
      default:
        throw new AppError('BAD_SETTING', 'Unknown setting key');
    }
    return merged;
  }

  async update<K extends Key>(key: K, value: any, admin: { id: string; role: string }, ip?: string) {
    const next = this.validate(key, value);
    const current = await this.get(key);
    await this.prisma.$transaction(async (tx) => {
      await tx.platformSetting.upsert({ where: { key }, create: { key, value: next as any, updatedBy: admin.id }, update: { value: next as any, updatedBy: admin.id } });
      await tx.settingChange.create({ data: { key, oldValue: current as any, newValue: next as any, adminId: admin.id } });
      await this.audit.log(tx, { actorId: admin.id, actorRole: admin.role, action: 'settings.update', targetType: 'setting', targetId: key, before: current, after: next, ip });
    });
    await this.reload();
    return next;
  }
}
