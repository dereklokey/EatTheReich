import type { DieFace } from "../domain/types.js";

/** A surviving player die after discard. */
export interface PlayerDie {
  face: DieFace;
  kind: "success" | "crit";
  /** Units this die is worth when allocated: success = 1, crit = 2. */
  units: number;
}

export interface PlayerDiceResult {
  survivors: PlayerDie[];
  discarded: DieFace[];
}

/**
 * DISCARD (RULES §4): discard all player dice ≤ threshold. Survivors:
 *   4–5 = success (1 unit), 6 = critical (2 units, can activate a SPECIAL).
 *
 * `threshold` defaults to 3 and is raised while a Rust-Witch is in play (Aura of
 * Misfortune) to 4, so only 5–6 survive (the 6 is still a crit).
 */
export function resolvePlayerDice(
  dice: readonly DieFace[],
  threshold = 3,
): PlayerDiceResult {
  const survivors: PlayerDie[] = [];
  const discarded: DieFace[] = [];
  for (const face of dice) {
    if (face <= threshold) {
      discarded.push(face);
    } else if (face === 6) {
      survivors.push({ face, kind: "crit", units: 2 });
    } else {
      survivors.push({ face, kind: "success", units: 1 });
    }
  }
  return { survivors, discarded };
}

/** Total allocatable units among surviving dice (success=1, crit=2). */
export function totalUnits(survivors: readonly PlayerDie[]): number {
  return survivors.reduce((sum, d) => sum + d.units, 0);
}

/**
 * GM successes (RULES §4/§5). GM dice have NO crit rule: a die ≥ threshold is one
 * success; a 6 is just one success. Standard threshold is ≥4.
 */
export function gmSuccesses(dice: readonly DieFace[], threshold = 4): DieFace[] {
  return dice.filter((f) => f >= threshold);
}
