/**
 * Pure engine barrel (RULES §4 turn pipeline):
 *   DECLARE → BUILD_PLAYER_POOL → BUILD_GM_POOL → ROLL → PRE_DISCARD_HOOKS →
 *   DISCARD → ALLOCATE → POST_ALLOCATE → INJURY_CHECK → DONE
 *
 * Every function here is pure over (state, dice) so the §12 golden tests can drive
 * it deterministically. No Cloudflare, no I/O.
 */
export * from "./playerPool.js";
export * from "./gmPool.js";
export * from "./dice.js";
export * from "./passives.js";
export * from "./allocate.js";
export * from "./challenge.js";
export * from "./injury.js";
export * from "./reinforcements.js";
export * from "./specials.js";

/** The turn state machine phases (RULES §4), in order. */
export const TURN_PHASES = [
  "DECLARE",
  "BUILD_PLAYER_POOL",
  "BUILD_GM_POOL",
  "ROLL",
  "PRE_DISCARD_HOOKS",
  "DISCARD",
  "ALLOCATE",
  "POST_ALLOCATE",
  "INJURY_CHECK",
  "DONE",
] as const;

export type TurnPhase = (typeof TURN_PHASES)[number];
