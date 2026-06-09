import type { CharacterRuntime, ActiveStance } from "./types.js";
import type { Objective, Stat } from "../domain/types.js";
import { STATS } from "../domain/types.js";

/**
 * Cross-turn stance selectors (Iryna's #36 advances). The `next-turn` stances (Hell's Ravenous Fire,
 * Enervation) are consumed by the reducer at TURN_STARTED, so they need no derive. Mantle of the Fell
 * Beast persists "until the Objective is completed" — rather than chase every path an Objective's rating
 * can reach 0 (advance, special damage, GM edit, explicit complete), we DERIVE it: the stance lingers on
 * the character but only counts while its bound Objective is still in play. One predicate the client pool,
 * the sheet, the item lock, and the handler's re-arm guard all share, so they never disagree.
 */

/** The character's active Mantle, if its bound Objective still exists with rating > 0; else undefined. */
export function activeMantle(
  char: CharacterRuntime | undefined,
  objectives: readonly Objective[],
): ActiveStance | undefined {
  const m = char?.stances?.find((s) => s.kind === "mantle");
  if (!m) return undefined;
  const obj = objectives.find((o) => o.id === m.objectiveId);
  return obj && obj.rating > 0 ? m : undefined;
}

/**
 * The character's effective stats under an active Mantle: `highStats` take `highValue`, every other
 * stat collapses to `lowValue` (BRAWL/TERRIFY → 4, all else → 1; rulebook p57). Returns `base`
 * unchanged when no Mantle is active, so callers can pass the sheet stats unconditionally.
 */
export function effectiveStats(
  base: Record<Stat, number>,
  mantle: ActiveStance | undefined,
): Record<Stat, number> {
  if (!mantle || mantle.kind !== "mantle") return base;
  const high = new Set(mantle.highStats ?? []);
  const out = {} as Record<Stat, number>;
  for (const s of STATS) out[s] = high.has(s) ? (mantle.highValue ?? base[s]) : (mantle.lowValue ?? base[s]);
  return out;
}

/** True when an active Mantle forbids item use this turn (rulebook p57: "you cannot use items"). */
export function itemsBlockedByMantle(
  char: CharacterRuntime | undefined,
  objectives: readonly Objective[],
): boolean {
  return activeMantle(char, objectives)?.blocksItems === true;
}
