import type { DieFace } from "../domain/types.js";

/**
 * PRE_DISCARD_HOOKS (RULES §4) — passives that read the *raw* dice, before discard.
 * Ordering is fixed by RULES §5:
 *   1. roll both pools
 *   2. determine GM successes (≥ threshold)
 *   3. apply per-1 reduction passives to GM *successful* dice
 *   4. apply player gain-on-1 passives (independent)
 *   5. discard player dice ≤ threshold
 *   6. allocate; defense removes GM dice; leftover GM successes drive injury
 *
 * This module covers steps 3–4. Each passive is a default the GM may override.
 */

/** Count of 1s among the raw player dice (drives both passive families). */
export function countOnes(playerDice: readonly DieFace[]): number {
  return playerDice.filter((f) => f === 1).length;
}

/**
 * Dead Man's Luck (Cosgrave) / Bone Armour (Flint): −1 GM *successful* die per 1
 * the player rolled. Applied to the count of GM successes (RULES §5 step 3),
 * floored at 0. Returns the reduced count.
 */
export function reduceGmSuccessesPerOne(
  gmSuccessCount: number,
  playerOnes: number,
): number {
  return Math.max(0, gmSuccessCount - playerOnes);
}

/**
 * Corpse Eater (Chuck): +1 Blood if any 1 was rolled (CLAUDE.md §3.2 —
 * "+1 Blood if any 1 rolled"). Returns the Blood delta (0 or 1).
 */
export function corpseEaterBlood(playerDice: readonly DieFace[]): number {
  return countOnes(playerDice) > 0 ? 1 : 0;
}
