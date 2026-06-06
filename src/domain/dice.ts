import type { DieFace } from "./types.js";

/**
 * The server rolls all dice (CLAUDE.md §3.1 — server-authoritative, no client
 * fudging). The engine takes a roller as a dependency so it stays pure and the
 * golden tests (RULES §12) can inject exact dice.
 */
export interface DiceRoller {
  /** Roll `n` d6. Returns `n` faces. */
  roll(n: number): DieFace[];
}

/**
 * Deterministic roller that hands back a fixed sequence, in order. Used by tests
 * to reproduce the rulebook's worked examples exactly. Throws if exhausted so a
 * test that under-provisions dice fails loudly instead of silently.
 */
export function sequenceRoller(sequence: DieFace[]): DiceRoller {
  let i = 0;
  return {
    roll(n: number): DieFace[] {
      if (i + n > sequence.length) {
        throw new Error(
          `sequenceRoller exhausted: asked for ${n} dice at index ${i} of ${sequence.length}`,
        );
      }
      const out = sequence.slice(i, i + n);
      i += n;
      return out;
    },
  };
}

/** Production roller. `rng` defaults to Math.random; injectable for seeding. */
export function randomRoller(rng: () => number = Math.random): DiceRoller {
  return {
    roll(n: number): DieFace[] {
      const out: DieFace[] = [];
      for (let k = 0; k < n; k++) {
        out.push(((Math.floor(rng() * 6) % 6) + 1) as DieFace);
      }
      return out;
    },
  };
}
