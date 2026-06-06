import { buildPlayerPool, type PoolBuildResult } from "@shared/engine/playerPool.js";
import type { CharacterSheet, Power, Equipment } from "@shared/domain/character.js";

/**
 * Client-side player-pool suggestion (RULES §4 BUILD_PLAYER_POOL). Reuses the very
 * same pure engine builder the server/tests use, so the number the table sees is the
 * canonical one — but it's only a *default*: the composer lets the player/GM edit the
 * final dice count before the roll (CLAUDE.md §0 "suggest, don't enforce").
 *
 * Unlike the engine helper, this takes an explicit `gear` list so the composer can fold
 * in both printed equipment *and* earned loot (the active loot slot, RULES §11) — they
 * roll dice identically. `usedItemIds` are the gear toggled on; `activatedPowerIds` are
 * the active abilities/advances folded in (each adds a die and spends its Blood cost).
 * `claimedBonusIds` are the gear/abilities whose printed (+tag) bonus the table claims as
 * true — the player ticks the condition right on the item; a claim only counts while its
 * item is in use.
 */
export function buildSuggestedPool(args: {
  statName: string;
  statRating: number;
  /** Selectable gear: the sheet's printed equipment plus the active loot item. */
  gear: Equipment[];
  /** Selectable abilities: the result of `activePowers`. */
  abilities: Power[];
  usedItemIds: string[];
  activatedPowerIds: string[];
  claimedBonusIds: string[];
  equipmentUses: Record<string, number>;
}): PoolBuildResult {
  const equipment = args.gear
    .filter((e) => args.usedItemIds.includes(e.id))
    .map((e) => ({
      label: e.name,
      bonusPlus: e.bonus?.plus,
      bonusSatisfied: e.bonus ? args.claimedBonusIds.includes(e.id) : false,
      // Go Out With A Bang only triggers on the final use of an item that started with
      // more than one use; pass usesBefore only when that precondition holds.
      ...((e.uses ?? 0) > 1 && args.equipmentUses[e.id] === 1 ? { usesBefore: 1 } : {}),
    }));

  const abilities = args.abilities
    .filter((p) => args.activatedPowerIds.includes(p.id))
    .map((p) => ({
      label: p.name,
      bonusPlus: p.bonus?.plus,
      bonusSatisfied: p.bonus ? args.claimedBonusIds.includes(p.id) : false,
    }));

  return buildPlayerPool({ stat: { name: args.statName, rating: args.statRating }, equipment, abilities });
}

/**
 * Active, die-adding abilities + unlocked active advances — what you can fold into a
 * roll. Effect/stance/setup actives (`addsDie === false`) are excluded: they don't
 * contribute a pool die and are used from the character sheet, not the composer.
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

/** Items that should spend a use when the action rolls (tracked-use gear only). */
export function itemsToSpend(
  gear: Equipment[],
  usedItemIds: string[],
  equipmentUses: Record<string, number>,
): string[] {
  return usedItemIds.filter(
    (id) => (equipmentUses[id] ?? 0) > 0 && gear.find((e) => e.id === id)?.uses !== undefined,
  );
}

export type { PoolBuildResult };
