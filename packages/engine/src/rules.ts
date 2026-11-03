/**
 * Table options. Two games are played on the same board:
 *  - «short»: classic nardi (backgammon style): checkers are hit and re-enter from the bar.
 *  - «long»: long nardi: no hitting, everyone starts from the «head», one checker may leave it per turn.
 * A match is played to `targetScore` points; a win is 1 point, a «mars» 2.
 */
export type Variant = 'short' | 'long';

export interface RuleConfig {
  variant: Variant;
  /** The match ends when a player reaches this many points (1 = a single game). */
  targetScore: number;
  /** «Mars»: winning before the opponent has borne off a single checker counts double. */
  marsEnabled: boolean;
  /** How well bots play. */
  botLevel: 'easy' | 'medium' | 'strong';
  /** Seconds a player has to act before the server plays for them (0 = no limit). */
  turnTimeoutSec: number;
}

export const DEFAULT_RULES: RuleConfig = {
  variant: 'short',
  targetScore: 3,
  marsEnabled: true,
  botLevel: 'medium',
  turnTimeoutSec: 45,
};

/** Allowed values for user-selectable options. Admin can narrow these further. */
export const RULE_LIMITS = {
  targetScore: [1, 3, 5, 7] as number[],
  turnTimeoutSec: { min: 15, max: 180 },
};

export class RuleConfigError extends Error {}

export function normalizeRules(input: Partial<RuleConfig> | undefined | null): RuleConfig {
  const r: RuleConfig = { ...DEFAULT_RULES, ...(input ?? {}) };
  if (r.variant !== 'short' && r.variant !== 'long') throw new RuleConfigError('variant must be short or long');
  if (!Number.isInteger(r.targetScore) || r.targetScore < 1 || r.targetScore > 25) throw new RuleConfigError('targetScore must be an integer in [1, 25]');
  if (typeof r.marsEnabled !== 'boolean') throw new RuleConfigError('marsEnabled must be boolean');
  if (!['easy', 'medium', 'strong'].includes(r.botLevel)) throw new RuleConfigError('botLevel must be easy, medium or strong');
  if (!Number.isInteger(r.turnTimeoutSec) || r.turnTimeoutSec < 0 || r.turnTimeoutSec > RULE_LIMITS.turnTimeoutSec.max) {
    throw new RuleConfigError(`turnTimeoutSec must be an integer in [0, ${RULE_LIMITS.turnTimeoutSec.max}]`);
  }
  // strip unknown keys so persisted configs stay clean
  const clean = {} as RuleConfig;
  for (const k of Object.keys(DEFAULT_RULES) as (keyof RuleConfig)[]) (clean as any)[k] = r[k];
  return clean;
}
