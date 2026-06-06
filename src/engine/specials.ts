import type { ActionContext } from "../domain/types.js";
import type { CharacterSheet, Special } from "../domain/character.js";
import { conditionMet } from "../domain/character.js";

/**
 * SPECIAL gating (RULES §7, golden test E).
 *
 * A SPECIAL is offered as a crit-allocation target only when:
 *  - its trigger is `crit`, AND
 *  - it isn't advance-gated, or the player has unlocked that advance, AND
 *  - its `requires` condition (if any) is met by the action context.
 *
 * Example: Chuck's Elbow Grease (crit + solo FIX Objective) appears only on a solo
 * FIX Objective action; otherwise it never shows and his crits behave normally.
 */
export function availableCritSpecials(
  character: CharacterSheet,
  ctx: ActionContext,
  unlockedAdvances: ReadonlySet<string> = new Set(),
): Special[] {
  return character.specials.filter((s) => {
    if (s.trigger.type !== "crit") return false;
    if (s.advanceGated && !unlockedAdvances.has(s.id)) return false;
    return conditionMet(s.trigger.requires, ctx);
  });
}

/** Condition-triggered SPECIALs (e.g. Nicole's Scavenger) — not crit-gated. */
export function availableConditionSpecials(
  character: CharacterSheet,
  ctx: ActionContext,
  unlockedAdvances: ReadonlySet<string> = new Set(),
): Special[] {
  return character.specials.filter((s) => {
    if (s.trigger.type !== "condition") return false;
    if (s.advanceGated && !unlockedAdvances.has(s.id)) return false;
    return conditionMet(s.trigger.requires, ctx);
  });
}
