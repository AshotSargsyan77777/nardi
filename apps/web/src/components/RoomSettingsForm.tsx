'use client';
import { useApp } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';
import { GameKind, kindOf } from '@nardi/engine';
import { DEFAULT_RULES as BLOT_DEFAULTS, RULE_LIMITS as BLOT_LIMITS } from '@nardi/engine/dist/blot';
import { ClockPicker, KIND_ICON, kindRules } from './PlayActions';

const BLOT_KEYS = ['targetScore', 'turnTimeoutSec', 'cardsBeforeBidding', 'dealStyle', 'botLevel', 'allowNoTrump', 'noTrumpDoubled', 'contraEnabled', 'recontraEnabled', 'allowKapotBid'];
import { Field, Toggle, inputCls } from './ui';

export interface RoomSettingsValue {
  rules: Record<string, any>;
  stake: number;
  currency: 'FUN';
  chatEnabled: boolean;
  allowBots: boolean;
}

export function defaultRoomSettings(defaults?: Record<string, any>): RoomSettingsValue {
  return { rules: { game: 'nardi', variant: defaults?.variant ?? 'short', targetScore: defaults?.targetScore ?? 3, turnTimeoutSec: defaults?.turnTimeoutSec ?? 45 }, stake: 0, currency: 'FUN', chatEnabled: true, allowBots: true };
}

/** Only shows options the owner made host-editable; all values are re-validated by the server. */
export function RoomSettingsForm({ value, onChange, disabled }: { value: RoomSettingsValue; onChange: (v: RoomSettingsValue) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const { config } = useApp();
  if (!config) return null;
  const g = config.game;
  const kind = kindOf(value.rules);
  const nardi = kind === 'short' || kind === 'long';
  // nardi: what the owner lets hosts change; checkers: the move timer; chess: the clock
  const blot = kind === 'blot';
  const editable = new Set<string>(nardi ? g.hostEditableRules : kind === 'checkers' ? ['turnTimeoutSec', 'botLevel'] : blot ? BLOT_KEYS : ['botLevel']);
  // blot has its own defaults; nardi uses the owner's
  const rule = (k: string) => value.rules[k] ?? (blot ? (BLOT_DEFAULTS as any)[k] : g.defaultRules[k]);
  const setKind = (k: GameKind) => {
    const keep = k === 'short' || k === 'long' ? { targetScore: rule('targetScore'), turnTimeoutSec: rule('turnTimeoutSec'), marsEnabled: rule('marsEnabled') } : k === 'checkers' ? { turnTimeoutSec: rule('turnTimeoutSec') } : {};
    onChange({ ...value, rules: { ...kindRules(k), ...keep, botLevel: rule('botLevel') } });
  };
  const clock = `${value.rules.clockMin ?? 5}+${value.rules.clockInc ?? 0}`;
  const setRule = (k: string, v: any) => onChange({ ...value, rules: { ...value.rules, [k]: v } });
  const stakeOptions = g.stakeOptions[value.currency] ?? [0];
  const currencies = (['FUN'] as const).filter((c) => (g.stakeOptions[c] ?? []).length > 0);
  return (
    <div className="space-y-4">
      {/* only the variants of this game (short / long nardi); the game itself is chosen on the home page */}
      {nardi && <div className="grid grid-cols-2 gap-2">
        {(['short', 'long'] as const).map((v) => (
          <button key={v} type="button" disabled={disabled} onClick={() => setKind(v)} className={`rounded-2xl p-3 text-left ring-1 transition ${kind === v ? 'bg-gold-400/15 ring-gold-400/60' : 'bg-black/20 ring-white/10'}`}>
            <div className="font-bold">{KIND_ICON[v]} {t(`variant.${v}`)}</div>
            <div className="text-xs text-white/50">{t(`variant.${v}.sub`)}</div>
          </button>
        ))}
      </div>}
      {kind === 'chess' && (
        <Field label={t('chess.clock')}>
          <ClockPicker clock={clock} onChange={(c) => { if (disabled) return; const [m, i] = c.split('+').map(Number); onChange({ ...value, rules: { ...value.rules, clockMin: m, clockInc: i } }); }} />
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {blot && (
          <Field label={t('friends.targetScore')}>
            <select disabled={disabled} className={inputCls} value={rule('targetScore')} onChange={(e) => setRule('targetScore', Number(e.target.value))}>
              {BLOT_LIMITS.targetScore.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
        )}
        {blot && (
          <Field label={t('friends.cardsBeforeBidding')}>
            <select disabled={disabled} className={inputCls} value={rule('cardsBeforeBidding')} onChange={(e) => setRule('cardsBeforeBidding', Number(e.target.value))}>
              <option value={8}>{t('friends.cards8')}</option>
              <option value={4}>{t('friends.cards4')}</option>
            </select>
          </Field>
        )}
        {blot && (
          <Field label={t('friends.dealStyle')}>
            <select disabled={disabled} className={inputCls} value={rule('dealStyle')} onChange={(e) => setRule('dealStyle', e.target.value)}>
              <option value="table">{t('friends.dealTable')}</option>
              <option value="random">{t('friends.dealRandom')}</option>
            </select>
          </Field>
        )}
        {nardi && editable.has('targetScore') && (
          <Field label={t('friends.targetScore')}>
            <select disabled={disabled} className={inputCls} value={rule('targetScore')} onChange={(e) => setRule('targetScore', Number(e.target.value))}>
              {g.allowedTargetScores.map((n) => <option key={n} value={n}>{n === 1 ? t('friends.oneGame') : t('friends.toPoints', { n })}</option>)}
            </select>
          </Field>
        )}
        {editable.has('turnTimeoutSec') && (
          <Field label={t('friends.turnTimer')}>
            <select disabled={disabled} className={inputCls} value={rule('turnTimeoutSec')} onChange={(e) => setRule('turnTimeoutSec', Number(e.target.value))}>
              {(blot ? [15, 30, 45, 60] : g.allowedTurnTimeouts).map((n) => <option key={n} value={n}>{n} {t('common.seconds')}</option>)}
            </select>
          </Field>
        )}
        {editable.has('botLevel') && (
          <Field label={t('bots.level')}>
            <select disabled={disabled} className={inputCls} value={rule('botLevel')} onChange={(e) => setRule('botLevel', e.target.value)}>
              {(['easy', 'medium', 'strong'] as const).map((l) => <option key={l} value={l}>{t(`bots.${l}`)}</option>)}
            </select>
          </Field>
        )}
        {currencies.length > 0 && (
          <Field label={t('friends.stake')}>
            <div className="flex gap-2">
              {currencies.length > 1 && (
                <select disabled={disabled} className={`${inputCls} w-28`} value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value as any, stake: 0 })}>
                  {currencies.map((c) => <option key={c} value={c}>{config.currencies.find((x) => x.code === c)?.symbol ?? c}</option>)}
                </select>
              )}
              <select disabled={disabled} className={inputCls} value={value.stake} onChange={(e) => onChange({ ...value, stake: Number(e.target.value), allowBots: Number(e.target.value) > 0 ? false : value.allowBots })}>
                {stakeOptions.map((n) => <option key={n} value={n}>{n === 0 ? t('friends.noStake') : `${n} ${config.currencies.find((x) => x.code === value.currency)?.symbol ?? ''}`}</option>)}
              </select>
            </div>
          </Field>
        )}
      </div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-white/50">{t('friends.rulesHeading')}</div>
      <div className="divide-y divide-white/5 rounded-xl bg-black/20 px-3">
        {blot && (['allowNoTrump', 'noTrumpDoubled', 'contraEnabled', 'recontraEnabled', 'allowKapotBid'] as const)
          .filter((k) => k !== 'noTrumpDoubled' || rule('allowNoTrump'))
          .map((k) => <Toggle key={k} disabled={disabled} label={t(`friends.${k}`)} checked={!!rule(k)} onChange={(v) => setRule(k, v)} />)}
        {nardi && editable.has('marsEnabled') && <Toggle disabled={disabled} label={t('friends.marsEnabled')} checked={!!rule('marsEnabled')} onChange={(v) => setRule('marsEnabled', v)} />}
        <Toggle disabled={disabled} label={t('friends.chat')} checked={value.chatEnabled} onChange={(v) => onChange({ ...value, chatEnabled: v })} />
        {config.features.practiceBotsEnabled && (
          <Toggle disabled={disabled || value.stake > 0} label={t('friends.allowBots')} checked={value.allowBots && value.stake === 0} onChange={(v) => onChange({ ...value, allowBots: v })} />
        )}
      </div>
    </div>
  );
}
