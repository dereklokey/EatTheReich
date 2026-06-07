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
 * success; a 6 is just one success. Standard threshold is ≥4. Returns the successful
 * faces (callers usually take `.length`); `whiffAnchor` relies on this plain semantics,
 * so the Vampirjäger's 'Anathema' boost lives in {@link gmSuccessTally}, not here.
 */
export function gmSuccesses(dice: readonly DieFace[], threshold = 4): DieFace[] {
  return dice.filter((f) => f >= threshold);
}

/** Count the 6s in a roll — the dice the Vampirjäger Cadre's 'Anathema' scores twice. */
export function countSixes(dice: readonly DieFace[]): number {
  return dice.reduce((n, f) => (f === 6 ? n + 1 : n), 0);
}

/**
 * Total GM successes for an action as a COUNT (RULES §4/§5), applying the Vampirjäger Cadre's
 * 'Anathema' (rulebook p64, issue #21): while it is in play, each GM Attack die showing a 6
 * scores **2** successes instead of 1 — i.e. +1 per 6. Like Painless/Aura, Anathema is a board
 * property — the Reich pool carries no per-Threat attribution (issue #8) — so the bonus rides
 * the whole aggregate roll. With `anathema=false` this is exactly `gmSuccesses(...).length`.
 */
export function gmSuccessTally(dice: readonly DieFace[], anathema = false, threshold = 4): number {
  return gmSuccesses(dice, threshold).length + (anathema ? countSixes(dice) : 0);
}
