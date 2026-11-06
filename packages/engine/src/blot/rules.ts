/**
 * Configurable rule set. Bazar Blot is played with several house variants in Armenia;
 * every point of divergence we know of is a parameter here so the owner can pick the
 * variant without code changes. Defaults describe the "standard club" variant documented
 * in docs/GAME_RULES.md.
 */
export interface RuleConfig {
  /** Match ends when a team reaches this many (scaled) points. */
  targetScore: number;
  /** Cards dealt before bidding (8 = whole hand, 5 = 3+2 then 3 more after the bazar). */
  /** 8 = all cards before the bazar; 4 = 4 before, 4 after. */
  cardsBeforeBidding: 4 | 8;
  /** 'table' = like at a real table: last hand's cards are collected, riffled once and cut; 'random' = full shuffle. */
  dealStyle: 'table' | 'random';
  /** How well bots play: easy (makes mistakes), medium, strong (remembers played cards). */
  botLevel: 'easy' | 'medium' | 'strong';
  /** Lowest and highest numeric contract (in scaled points: 8 = 80 card points). */
  minBid: number;
  maxBid: number;
  /** Whether a "Kapot" (all eight tricks) contract may be bid. */
  allowKapotBid: boolean;
  /** Scaled value of taking all tricks (replaces the normal 16). */
  kapotPoints: number;
  /** Scaled value of a normal hand (162 card points / 10, rounded). */
  handPoints: number;
  /** "Անղոզ" / բոյ: a contract without a trump suit. */
  allowNoTrump: boolean;
  /** No-trump (բոյ): the bid number counts one multiplier step higher (×2 / ×3 / ×5). */
  noTrumpDoubled: boolean;
  contraEnabled: boolean;
  recontraEnabled: boolean;
  /** If true, players must beat a trump already in the trick whenever they can. */
  mustOvertrump: boolean;
  /** Bidder must also score more than the defenders (not only reach the contract). */
  bidderMustOutscore: boolean;
  /** When the contract fails, defenders additionally receive the contract value. */
  failAddsContractValue: boolean;
  /** Blot (K+Q of trump) always stays with the team that holds it, even if contract fails. */
  blotAlwaysKept: boolean;
  /** Seconds a player has to act before the server auto-plays (0 = no limit). */
  turnTimeoutSec: number;
}

export const DEFAULT_RULES: RuleConfig = {
  targetScore: 301,
  cardsBeforeBidding: 8,
  dealStyle: 'table',
  botLevel: 'medium',
  minBid: 8,
  maxBid: 63,
  allowKapotBid: true,
  kapotPoints: 25,
  handPoints: 16,
  allowNoTrump: true,
  noTrumpDoubled: true,
  contraEnabled: true,
  recontraEnabled: true,
  mustOvertrump: true,
  bidderMustOutscore: false,
  failAddsContractValue: true,
  blotAlwaysKept: false,
  turnTimeoutSec: 30,
};

/** Allowed values for user-selectable options. Admin can narrow these further. */
export const RULE_LIMITS = {
  targetScore: [51, 101, 151, 201, 301] as number[],
  turnTimeoutSec: { min: 10, max: 120 },
  minBid: { min: 7, max: 10 },
  maxBid: { min: 12, max: 63 },
};

export class RuleConfigError extends Error {}

export function normalizeRules(input: Partial<RuleConfig> | undefined | null): RuleConfig {
  const r: RuleConfig = { ...DEFAULT_RULES, ...(input ?? {}) };
  // removed option (trumping is never required when the partner's card is the strongest)
  delete (r as any).mustTrumpWhenPartnerWinning;
  const bool = (k: keyof RuleConfig) => {
    if (typeof r[k] !== 'boolean') throw new RuleConfigError(`${k} must be boolean`);
  };
  const int = (k: keyof RuleConfig, min: number, max: number) => {
    const v = r[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      throw new RuleConfigError(`${k} must be an integer in [${min}, ${max}]`);
    }
  };
  int('targetScore', 11, 1001);
  if ((r.cardsBeforeBidding as number) === 5) r.cardsBeforeBidding = 4; // old «5 + 3» setting
  if (r.cardsBeforeBidding !== 4 && r.cardsBeforeBidding !== 8) throw new RuleConfigError('cardsBeforeBidding must be 4 or 8');
  if (r.dealStyle !== 'table' && r.dealStyle !== 'random') throw new RuleConfigError('dealStyle must be table or random');
  if (!['easy', 'medium', 'strong'].includes(r.botLevel)) throw new RuleConfigError('botLevel must be easy, medium or strong');
  int('minBid', RULE_LIMITS.minBid.min, RULE_LIMITS.minBid.max);
  int('maxBid', RULE_LIMITS.maxBid.min, RULE_LIMITS.maxBid.max);
  if (r.minBid > r.maxBid) throw new RuleConfigError('minBid must not exceed maxBid');
  int('kapotPoints', 16, 50);
  int('handPoints', 16, 16);
  int('turnTimeoutSec', 0, RULE_LIMITS.turnTimeoutSec.max);
  (['allowKapotBid', 'allowNoTrump', 'noTrumpDoubled', 'contraEnabled', 'recontraEnabled', 'mustOvertrump',
    'bidderMustOutscore', 'failAddsContractValue', 'blotAlwaysKept'] as const).forEach(bool);
  if (!r.contraEnabled) r.recontraEnabled = false;
  // Strip unknown keys so persisted configs stay clean.
  const clean = {} as RuleConfig;
  for (const k of Object.keys(DEFAULT_RULES) as (keyof RuleConfig)[]) (clean as any)[k] = r[k];
  return clean;
}
