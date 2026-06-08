import type { Target } from "../domain/types.js";
import { isChallengeUnlowerable } from "../domain/types.js";

/**
 * Lowering a target's Challenge (RULES §6). This is THE single chokepoint every
 * Challenge-reduction effect routes through — Nicole's Sapper (#29), Astrid's Tethered
 * Phantom / Flint's Hellish Screech (#35), and the −1-Challenge secondary-objective reward
 * (#37). Centralising it means the Werhund's 'Unlowerable Challenge' (rulebook p64, issue #25)
 * is enforced in ONE place: a Threat flagged {@link isChallengeUnlowerable} is immune and keeps
 * its Challenge unchanged, so no effect can chip it and none has to remember the rule.
 *
 * Pure — returns the NEW Challenge value, clamped to [0, current] for a normal target. The
 * caller writes it back (and can compare against the old value, or call `isChallengeUnlowerable`
 * directly, to surface the "can't be lowered" message when the request was blocked).
 */
export function lowerChallenge(target: Target, by: number): number {
  const current = target.challenge ?? 0;
  if (isChallengeUnlowerable(target)) return current; // Werhund: immune (issue #25)
  return Math.max(0, current - Math.max(0, by));
}
