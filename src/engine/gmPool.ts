import type { Threat } from "../domain/types.js";

/**
 * BUILD_GM_POOL (RULES §4):
 *   max(Attack of Threats in play) + (Threats in play − 1)
 *
 * The Reich pool is a property of the *board*, not of the player's action. The acting
 * player does NOT pick which Threat to "attack" or "avoid": the rulebook is explicit that
 * a Threat the player is "engaged with **or actively avoiding**" still rolls its Attack
 * (rulebook p36), so avoidance buys nothing. Every Threat in play therefore contributes:
 * the most dangerous one (highest Attack) rolls its full Attack, and every *other* Threat
 * in play adds 1 die.
 *
 * - "In play" = rating > 0. A defeated Threat (rating 0 → Attack 0) contributes neither its
 *   Attack nor the "+1 per additional Threat" (golden test B: Infantry Squad dead → the
 *   objective roll faces 2, not 3).
 * - No Threats in play → 0 dice → the action is **uncontested** and the player cannot be
 *   injured this turn. This is the only uncontested case: it happens when the table has
 *   killed off every Threat (or the GM has framed a Threat-free scene). Stealth/safety is
 *   modelled by the GM simply keeping a not-yet-aware enemy off the board until it notices
 *   the party (RULES §11).
 *
 * The result is a default the GM can override before ROLL (CLAUDE.md §0).
 */
export function buildGmPool(threats: Threat[]): number {
  const inPlay = threats.filter((t) => t.rating > 0);
  if (inPlay.length === 0) return 0;

  const maxAttack = Math.max(...inPlay.map((t) => t.attack));
  return maxAttack + (inPlay.length - 1); // +1 per additional Threat in play
}

/** How many Reich dice each Threat in play contributes, for display. */
export interface GmPoolContribution {
  threat: Threat;
  /** Dice this Threat adds to the pool: the anchor rolls its full Attack, others add 1. */
  dice: number;
  /** The single most-dangerous Threat (highest Attack) that anchors the pool. */
  anchor: boolean;
}

/**
 * Break the GM pool down per Threat so the UI can show the red dice each one brings. The
 * most dangerous Threat in play (highest Attack; ties → first in the given order) anchors
 * the pool with its full Attack; every other in-play Threat adds exactly 1. The sum equals
 * {@link buildGmPool}.
 */
export function gmPoolContributions(threats: Threat[]): GmPoolContribution[] {
  const inPlay = threats.filter((t) => t.rating > 0);
  if (inPlay.length === 0) return [];

  let anchorIdx = 0;
  for (let i = 1; i < inPlay.length; i++) {
    if (inPlay[i]!.attack > inPlay[anchorIdx]!.attack) anchorIdx = i;
  }
  return inPlay.map((threat, i) => ({
    threat,
    dice: i === anchorIdx ? threat.attack : 1,
    anchor: i === anchorIdx,
  }));
}
