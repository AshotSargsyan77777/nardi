import { createHash, randomBytes, randomInt } from 'crypto';
import { fullDeck as blotDeck } from '@nardi/engine/dist/blot';

export type Roll = [number, number];

/** How many rolls are prepared for a game up front (more are added if a game runs longer). */
export const ROLLS_PER_GAME = 400;

/** Dice from the OS CSPRNG (crypto.randomInt). Never rolled on the client. */
export function secureRolls(n = ROLLS_PER_GAME): Roll[] {
  return Array.from({ length: n }, () => [1 + randomInt(6), 1 + randomInt(6)] as Roll);
}

/**
 * Commit–reveal: before a game starts the server fixes all its dice and publishes SHA-256(salt:dice).
 * After the game the dice and salt are revealed, so anyone can check the dice were set before play
 * and never changed to favour anyone.
 */
export function commitRolls(rolls: Roll[]) {
  const salt = randomBytes(16).toString('hex');
  return { salt, commitment: rollsCommitment(salt, rolls) };
}

export function rollsCommitment(salt: string, rolls: Roll[]) {
  return createHash('sha256').update(`${salt}:${rolls.map((r) => r.join('')).join(',')}`).digest('hex');
}

export function eloDelta(teamA: number[], teamB: number[], scoreA: number, k = 32) {
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const ea = 1 / (1 + 10 ** ((avg(teamB) - avg(teamA)) / 400));
  return Math.round(k * (scoreA - ea));
}

// ---------------------------------------------------------------- blot decks

/** Fisher–Yates shuffle of the 32-card blot deck driven by the OS CSPRNG. Never done on the client. */
export function secureShuffle(): string[] {
  const d = blotDeck();
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/**
 * A deal «like at a real table»: the last hand's cards, as they were picked up, get a light overhand
 * shuffle (packets of 3–8 cards) and a cut, so combinations come up more often than after a full
 * shuffle. Randomness still comes only from the OS CSPRNG.
 */
export function tableShuffle(collected: string[]): string[] {
  if (collected.length !== 32) return secureShuffle();
  const src = [...collected];
  const out: string[] = [];
  while (src.length) out.unshift(...src.splice(0, Math.min(src.length, 3 + randomInt(6))));
  const c = 4 + randomInt(out.length - 7);
  return [...out.slice(c), ...out.slice(0, c)];
}

/** Commit–reveal for a deck: SHA-256(salt:deck) is published before the hand, deck and salt after. */
export function commitDeck(deck: string[]) {
  const salt = randomBytes(16).toString('hex');
  return { salt, commitment: deckCommitment(salt, deck) };
}
export function deckCommitment(salt: string, deck: string[]) {
  return createHash('sha256').update(`${salt}:${deck.join(',')}`).digest('hex');
}
