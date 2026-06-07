import type { ActionContext, Threat } from "../domain/types.js";
import { threatInPlay } from "../domain/types.js";
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

/**
 * Board-granted SPECIALs (RULES §7; issue #23) — the first crit-SPECIALs sourced from the
 * *enemy* rather than the character sheet. The Motorcycle Squad's 'Crash & Burn' (rulebook p61)
 * grants EVERY acting vampire a crit-SPECIAL that inflicts a flat 3 damage to it while it's in
 * play ("engaged with" = in play, the issue #8 board model). `availableCritSpecials` only sees
 * the sheet, so the allocation tray composes these from the board too and offers them to anyone.
 *
 * The id is namespaced by the granting Threat (`crash-and-burn:<threatId>`) so multiple squads
 * each grant their own, distinct from any sheet power. {@link applyOneAllocation} recognises the
 * prefix (via {@link isBoardSpecialId}) and applies the carried damage to the target Threat.
 */
export const CRASH_AND_BURN_DAMAGE = 3;
const CRASH_AND_BURN_PREFIX = "crash-and-burn:";

export interface BoardSpecial {
  /** Crit-SPECIAL id, namespaced by the granting Threat. */
  id: string;
  /** The Threat that grants it AND is its target. */
  threatId: string;
  /** Display name for the crit tray. */
  name: string;
  /** Flat damage inflicted on the target when a crit is spent here. */
  damage: number;
  /** Tooltip / rules text. */
  hint: string;
}

export function boardGrantedSpecials(threats: readonly Threat[]): BoardSpecial[] {
  return threats
    .filter((t) => threatInPlay(t) && (t.rules ?? []).includes("crash-and-burn"))
    .map((t) => ({
      id: `${CRASH_AND_BURN_PREFIX}${t.id}`,
      threatId: t.id,
      name: `Crash & Burn — ${t.name}`,
      damage: CRASH_AND_BURN_DAMAGE,
      hint: "Motorcycle Squad 'Crash & Burn' (rulebook p61): spend a crit to inflict 3 damage to it.",
    }));
}

/** True for a SPECIAL id minted by {@link boardGrantedSpecials} — a crit allocated to one deals
 *  its carried `units` as flat damage to the allocation's `targetId` (the granting Threat). */
export const isBoardSpecialId = (id: string | undefined): id is string =>
  typeof id === "string" && id.startsWith(CRASH_AND_BURN_PREFIX);
