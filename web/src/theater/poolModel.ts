import { buildPlayerPool, type PoolBuildResult } from "@shared/engine/playerPool.js";
import type { CharacterSheet, Power } from "@shared/domain/character.js";
import type { Stat } from "@shared/domain/types.js";

/**
 * Client-side player-pool suggestion (RULES §4 BUILD_PLAYER_POOL). Reuses the very
 * same pure engine builder the server/tests use, so the number the table sees is the
 * canonical one — but it's only a *default*: the pool builder lets the player/GM edit
 * the final dice count before the roll (CLAUDE.md §0 "suggest, don't enforce").
 *
 * `usedItemIds` are the equipment toggled on; `activatedPowerIds` are the active
 * abilities/advances folded into this roll (each adds a die and spends its Blood cost,
 * RULES §4). `claimedBonusIds` are the gear/abilities whose printed (+tag) bonus the
 * table claims as true — the player ticks the condition right next to the item (no typed
 * tags to spell), and the GM, co-driving, confirms it. A claim only counts while its
 * item is in use.
 */
export function buildSuggestedPool(
  sheet: CharacterSheet | undefined,
  stat: Stat,
  usedItemIds: string[],
  activatedPowerIds: string[],
  claimedBonusIds: string[],
  equipmentUses: Record<string, number>,
  unlockedAdvanceIds: string[],
): PoolBuildResult {
  const statRating = sheet?.stats[stat] ?? 2;

  const equipment = (sheet?.equipment ?? [])
    .filter((e) => usedItemIds.includes(e.id))
    .map((e) => ({
      label: e.name,
      bonusPlus: e.bonus?.plus,
      bonusSatisfied: e.bonus ? claimedBonusIds.includes(e.id) : false,
      // Go Out With A Bang only triggers on the final use of an item that started
      // with more than one use; pass usesBefore only when that precondition holds.
      ...((e.uses ?? 0) > 1 && equipmentUses[e.id] === 1 ? { usesBefore: 1 } : {}),
    }));

  const abilities = activePowers(sheet, unlockedAdvanceIds)
    .filter((p) => activatedPowerIds.includes(p.id))
    .map((p) => ({
      label: p.name,
      bonusPlus: p.bonus?.plus,
      bonusSatisfied: p.bonus ? claimedBonusIds.includes(p.id) : false,
    }));

  return buildPlayerPool({ stat: { name: stat, rating: statRating }, equipment, abilities });
}

/**
 * Active, die-adding abilities + unlocked active advances — what you can fold into a
 * roll. Effect/stance/setup actives (`addsDie === false`) are excluded: they don't
 * contribute a pool die and are used from the character sheet, not the theater.
 */
export function activePowers(
  sheet: CharacterSheet | undefined,
  unlockedAdvanceIds: string[],
): Power[] {
  if (!sheet) return [];
  return [
    ...sheet.abilities,
    ...sheet.advances.filter((p) => unlockedAdvanceIds.includes(p.id)),
  ].filter((p) => p.mechanic === "active" && p.addsDie !== false);
}

/** Items that should spend a use when the action rolls (tracked-use items only). */
export function itemsToSpend(
  sheet: CharacterSheet | undefined,
  usedItemIds: string[],
  equipmentUses: Record<string, number>,
): string[] {
  return usedItemIds.filter((id) => (equipmentUses[id] ?? 0) > 0 && (sheet?.equipment.find((e) => e.id === id)?.uses !== undefined));
}

export type { PoolBuildResult };
