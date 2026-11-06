import { createHash, randomBytes, randomInt } from 'crypto';

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
