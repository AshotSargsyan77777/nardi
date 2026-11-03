# Nardi — implemented rules

Two players, 24 points, 15 checkers each. Seat 0 plays white, seat 1 black. Each player counts the
board from their own side: point 24 is where they start, 1–6 is their home, 0 is off the board.

## Common rules

- The server rolls two dice (crypto RNG). Doubles are played four times.
- Each die is one step. Play as many dice as possible; if only one of two different dice can be
  played, it must be the bigger one. With no legal step the turn passes.
- Bearing off starts once all 15 checkers are home: with the exact number, or with a bigger die from
  the farthest occupied point when no checker is farther.
- The first to bear off 15 checkers wins the game: 1 point, or 2 for a **mars** (the loser has not
  borne off a single checker; `marsEnabled`). The winner of a game starts the next one; the first
  game's starter is random.
- A match is played to `targetScore` points (1, 3, 5 or 7 by default).

## Short nardi (`variant: 'short'`)

- Start: 2 on 24, 5 on 13, 3 on 8, 5 on 6; black mirrored.
- A point with two or more opponent checkers is closed. Landing on a single opponent checker hits it:
  it goes to the bar and must re-enter in the opponent's home (25 − die) before any other step.

## Long nardi (`variant: 'long'`)

- All 15 checkers start on the head (white on 24, black on white's 12); both move the same way round,
  black's home is white's 13–18.
- No hitting: a point holding any opponent checker is closed.
- Only one checker may leave the head per turn; on a player's first turn 6-6, 4-4 or 3-3 lets two leave.
- Six own points in a row are not allowed unless at least one opponent checker is already past them.

## Fairness

Before each game the server generates its dice list, publishes `sha256(salt:dice)` and uses the list
in order. After the game the list and salt are revealed (`revealedDice` in match state, `fairness` in
the match summary), so anyone can verify the dice were fixed before play.

## Timers

If a player does not act within `turnTimeoutSec`, the server rolls for them or plays a reasonable move.
Repeated timeouts (3 while offline, 6 overall) forfeit the match.
