import type { DiceRoller } from "../domain/dice.js";

/**
 * Injuries, Downed, Death (RULES §5).
 *
 * Each character has a UNIQUE track: 3 categories × 2 boxes = 6 total. The d6→
 * category mapping is per-character (defaults to 2 faces per category) and, like
 * everything else, GM-overridable.
 */

/** Boxes marked in each of the 3 categories (0–2 each). */
export type InjuryTrack = [number, number, number];

export const emptyInjuryTrack = (): InjuryTrack => [0, 0, 0];

/** Default d6 → category index: 1-2 → 0, 3-4 → 1, 5-6 → 2. */
export function defaultCategoryFromD6(face: number): 0 | 1 | 2 {
  return (Math.floor((face - 1) / 2) as 0 | 1 | 2);
}

export type InjuryOutcome =
  | { kind: "none" }
  | {
      kind: "injury";
      category: 0 | 1 | 2;
      /** Which box was ticked in the resolved category. */
      box: 1 | 2;
      /** True when this was the 2nd box in a category → mechanical penalty fires. */
      penaltyTriggered: boolean;
    }
  | {
      kind: "downed";
      category: 0 | 1 | 2;
      /** Rescue becomes a Secondary Objective, rating ~2–4 (GM sets). */
      rescueObjectiveRating: number;
    }
  | { kind: "death" }; // all 6 boxes already marked → Last Stand (RULES §5)

export interface InjuryOpts {
  categoryFromD6?: (face: number) => 0 | 1 | 2;
  /** GM-set rescue objective rating for a Downed result. Default 3 (RULES §5: 2–4). */
  rescueObjectiveRating?: number;
}

/**
 * INJURY_CHECK (RULES §4) on the GM Attack dice left after Defend, given an
 * ALREADY-ROLLED category d6 — the roll-free core. The server rolls the d6 itself so
 * it can park the result for the table to see (and react to with reactive gear) before
 * the box is actually marked; replay then re-derives the same outcome from the stored
 * face. `injuryCheck` below is the convenience wrapper that rolls and delegates here.
 *   0 leftover → none · 1–2 → one Injury · 3+ → Downed.
 *
 * No track mutation happens here; callers pass the current track and receive the
 * resolved category/box so the event layer can record the mutation.
 */
export function resolveInjury(
  leftoverGmDice: number,
  track: InjuryTrack,
  face: number,
  opts: InjuryOpts = {},
): InjuryOutcome {
  if (leftoverGmDice <= 0) return { kind: "none" };

  const mapCategory = opts.categoryFromD6 ?? defaultCategoryFromD6;
  const category = mapCategory(face);

  if (leftoverGmDice >= 3) {
    return {
      kind: "downed",
      category,
      rescueObjectiveRating: opts.rescueObjectiveRating ?? 3,
    };
  }

  // 1–2 leftover → one Injury. Resolve which box (cascade rules in markInjury).
  const resolved = markInjury(track, category);
  if (resolved.overflowToDeath) return { kind: "death" };
  return {
    kind: "injury",
    category: resolved.category,
    box: resolved.box,
    penaltyTriggered: resolved.box === 2,
  };
}

/**
 * Roll the category d6 and resolve the INJURY_CHECK in one step (RULES §4). Only draws
 * from the roller when there's actually a leftover GM die, so an injury-free turn costs
 * no RNG (keeps replay/test dice sequences tight).
 */
export function injuryCheck(
  leftoverGmDice: number,
  track: InjuryTrack,
  roller: DiceRoller,
  opts: InjuryOpts = {},
): InjuryOutcome {
  if (leftoverGmDice <= 0) return { kind: "none" };
  const face = roller.roll(1)[0] as number;
  return resolveInjury(leftoverGmDice, track, face, opts);
}

export interface MarkResult {
  track: InjuryTrack;
  category: 0 | 1 | 2;
  box: 1 | 2;
  /** True when no box was free anywhere → all 6 marked → Last Stand. */
  overflowToDeath: boolean;
}

/**
 * Mark one Injury (RULES §5): tick the first open box in the rolled category; if
 * the first is taken, the second; if both are taken, an alternate category. Returns
 * a NEW track plus where the mark landed.
 */
export function markInjury(track: InjuryTrack, category: 0 | 1 | 2): MarkResult {
  const next: InjuryTrack = [...track] as InjuryTrack;

  if (next[category] < 2) {
    next[category] += 1;
    return {
      track: next,
      category,
      box: next[category] as 1 | 2,
      overflowToDeath: false,
    };
  }

  // Category full → spill into the first alternate with a free box.
  for (let c = 0 as 0 | 1 | 2; c < 3; c = (c + 1) as 0 | 1 | 2) {
    if (next[c] < 2) {
      next[c] += 1;
      return {
        track: next,
        category: c,
        box: next[c] as 1 | 2,
        overflowToDeath: false,
      };
    }
  }

  // Nowhere free → all 6 marked → Death / Last Stand.
  return { track: next, category, box: 2, overflowToDeath: true };
}

/** Downed marks ALL boxes in the rolled category (RULES §5). Returns a new track. */
export function markDowned(track: InjuryTrack, category: 0 | 1 | 2): InjuryTrack {
  const next: InjuryTrack = [...track] as InjuryTrack;
  next[category] = 2;
  return next;
}

/**
 * Werhund 'Rending Claws' (RULES §5, rulebook p64): a normal (non-Downed) Injury attributed
 * to the Werhund marks ALL boxes in the wound's category — Downed-like severity, but it is
 * still an Injury, NOT a Downed (the vampire stays in the fight; no rescue Objective). The
 * upgrade keeps the category `resolveInjury` already landed (its cascade is respected) and
 * fills it: `box` becomes 2, so the reducer maxes the category to 2 and the 2nd-box penalty
 * fires. A non-injury outcome (downed/death/none) is returned untouched — there is nothing
 * to escalate. Because the GM Attack pool is aggregate (no per-Threat attribution), the table
 * decides whether this hit was the Werhund's before the upgrade applies (the `acknowledge`
 * hook); this pure helper just performs the escalation it's told to.
 */
export function rendInjury(outcome: InjuryOutcome): InjuryOutcome {
  if (outcome.kind !== "injury") return outcome;
  return { kind: "injury", category: outcome.category, box: 2, penaltyTriggered: true };
}

/**
 * Last Stand pool (RULES §5, rulebook p36): all 6 boxes marked → "roll 8D6. Apply them
 * to the current Objectives and Threats however you like." No GM pool, no discard, no
 * threshold — *every* die counts (a 6 is still a critical worth 2). The reducer maps the
 * rolled faces straight to survivors.
 */
export const LAST_STAND_DICE = 8;
