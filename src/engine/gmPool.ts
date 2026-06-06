import type { Threat } from "../domain/types.js";

/**
 * BUILD_GM_POOL (RULES §4):
 *   max(Attack of engaged Threats) + (totalThreatsInPlay − 1)
 *
 * - "In play" = rating > 0. A defeated Threat (rating 0 → Attack 0) contributes
 *   neither its Attack nor the "+1 per additional Threat" (golden test B: with the
 *   Infantry Squad dead, the objective roll faces 2, not 3).
 * - No engaged Threat → 0 dice → the player cannot be injured this turn (RULES §3
 *   engagement; this is how stealth/safety is modelled).
 *
 * The result is a default the GM can override before ROLL (CLAUDE.md §0).
 */
export function buildGmPool(threats: Threat[], engagedIds: readonly string[]): number {
  const inPlay = threats.filter((t) => t.rating > 0);
  const engaged = inPlay.filter((t) => engagedIds.includes(t.id));
  if (engaged.length === 0) return 0;

  const maxAttack = Math.max(...engaged.map((t) => t.attack));
  const extra = inPlay.length - 1; // +1 per additional Threat in play
  return maxAttack + Math.max(0, extra);
}
