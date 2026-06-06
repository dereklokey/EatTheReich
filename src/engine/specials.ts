import type { ActionContext } from "../domain/types.js";
import type { CharacterSheet, Power } from "../domain/character.js";
import { conditionMet, specialsOf } from "../domain/character.js";

/**
 * SPECIAL gating (RULES §7, rulebook p33, golden test E).
 *
 * A SPECIAL is offered as a crit-allocation target only when:
 *  - it's a crit-triggered special, AND
 *  - it isn't an advance the player hasn't unlocked, AND
 *  - its `requires` condition (if any) is met by the action context.
 *
 * Example: Chuck's Elbow Grease (crit + solo FIX Objective) appears only on a solo
 * FIX Objective action; otherwise it never shows and his crits behave normally.
 */
export function availableCritSpecials(
  character: CharacterSheet,
  ctx: ActionContext,
  unlockedAdvances: ReadonlySet<string> = new Set(),
): Power[] {
  return specialsOf(character)
    .filter(({ power, advanceGated }) => {
      if (power.trigger?.type !== "crit") return false;
      if (advanceGated && !unlockedAdvances.has(power.id)) return false;
      return conditionMet(power.trigger.requires, ctx);
    })
    .map(({ power }) => power);
}
