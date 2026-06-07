import { type Threat, type DieFace, threatInPlay } from "../domain/types.js";
import { gmSuccesses } from "./dice.js";

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
 * - "In play" = {@link threatInPlay}: rating > 0 AND not staged. A defeated Threat (rating
 *   0 → Attack 0) contributes neither its Attack nor the "+1 per additional Threat" (golden
 *   test B: Infantry Squad dead → the objective roll faces 2, not 3). A *staged* Threat
 *   (issue #12 — placed but not yet activated) likewise contributes nothing until revealed.
 * - No Threats in play → 0 dice → the action is **uncontested** and the player cannot be
 *   injured this turn. This is the only uncontested case: it happens when the table has
 *   killed off every Threat (or the GM has framed a Threat-free scene). Stealth/safety is
 *   modelled by the GM simply keeping a not-yet-aware enemy off the board until it notices
 *   the party (RULES §11).
 *
 * The result is a default the GM can override before ROLL (CLAUDE.md §0).
 */
export function buildGmPool(threats: Threat[]): number {
  const inPlay = threats.filter(threatInPlay);
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
  const inPlay = threats.filter(threatInPlay);
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

/**
 * GM-whiff escalation (RULES §8, rulebook p38): "If the GM rolls zero successes on their
 * Attack dice, increase the Threat's Attack by 1 once the player has resolved their
 * action." We apply this the moment the action concludes (not at end of round), and only
 * to the ANCHOR — the single most-dangerous Threat that led the volley (`gmPoolContributions`).
 *
 * Returns that anchor Threat so the caller can bump its Attack by 1, or `null` when there's
 * nothing to bump: the Reich didn't roll (uncontested — no dice), it rolled at least one
 * success (no whiff), or no Threat is left in play. Detection uses the RAW roll: a player
 * passive that cancels GM successes (Dead Man's Luck / Bone Armour) is the player's doing,
 * not a nazi fumble, so a cancelled-to-zero roll is NOT a whiff.
 */
export function whiffAnchor(threats: Threat[], gmDice: readonly DieFace[]): Threat | null {
  if (gmDice.length === 0) return null; // uncontested / the Reich never rolled
  if (gmSuccesses(gmDice).length > 0) return null; // at least one success → not a whiff
  return gmPoolContributions(threats).find((c) => c.anchor)?.threat ?? null;
}
