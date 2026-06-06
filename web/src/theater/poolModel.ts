import { buildPlayerPool, type PoolBuildResult } from "@shared/engine/playerPool.js";
import type { CharacterSheet } from "@shared/domain/character.js";
import type { Stat } from "@shared/domain/types.js";

/**
 * Client-side player-pool suggestion (RULES §4 BUILD_PLAYER_POOL). Reuses the very
 * same pure engine builder the server/tests use, so the number the table sees is the
 * canonical one — but it's only a *default*: the pool builder lets the player/GM edit
 * the final dice count before the roll (CLAUDE.md §0 "suggest, don't enforce").
 *
 * `usedItemIds` are equipment toggled on for this action; `tags` are the narration
 * tags from DECLARE that satisfy a weapon's (+tag) bonus.
 */
export function buildSuggestedPool(
  sheet: CharacterSheet | undefined,
  stat: Stat,
  tags: string[],
  usedItemIds: string[],
  equipmentUses: Record<string, number>,
): PoolBuildResult {
  const statRating = sheet?.stats[stat] ?? 2;

  const equipment = (sheet?.equipment ?? [])
    .filter((e) => usedItemIds.includes(e.id))
    .map((e) => ({
      label: e.name,
      bonusPlus: e.bonus?.plus,
      bonusSatisfied: e.bonus ? tags.includes(e.bonus.tag) : false,
      // Go Out With A Bang only triggers on the final use of an item that started
      // with more than one use; pass usesBefore only when that precondition holds.
      ...((e.uses ?? 0) > 1 && equipmentUses[e.id] === 1 ? { usesBefore: 1 } : {}),
    }));

  return buildPlayerPool({ stat: { name: stat, rating: statRating }, equipment });
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
