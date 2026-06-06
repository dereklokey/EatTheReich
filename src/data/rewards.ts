/**
 * Secondary Objective reward menu (rulebook p38). On completing a Secondary
 * Objective, the player chooses ONE of these. The `magnitude` is the numeric
 * default the GM/engine applies (some reward dice are 1d6, resolved at runtime).
 */
import type { BonusRequirement } from "../domain/character.js";

export interface SecondaryObjectiveReward {
  id: string;
  label: string;
  /** "objective" | "threat" | "blood" | "attack" | "challenge" | "equipment". */
  kind: "objective" | "threat" | "blood" | "attack" | "challenge" | "equipment";
  /** "d6" for 1d6 effects; a number for fixed effects; undefined for equipment. */
  amount?: "d6" | number;
}

export const SECONDARY_OBJECTIVE_REWARDS: SecondaryObjectiveReward[] = [
  { id: "reduce-objective-d6", label: "Reduce a primary Objective by D6", kind: "objective", amount: "d6" },
  { id: "reduce-threat-d6", label: "Reduce a Threat by D6", kind: "threat", amount: "d6" },
  { id: "gain-blood-d6", label: "Gain D6 Blood", kind: "blood", amount: "d6" },
  { id: "reduce-attack-2", label: "Reduce a Threat's Attack by 2", kind: "attack", amount: 2 },
  { id: "reduce-challenge-1", label: "Reduce a Threat or Objective's Challenge by 1", kind: "challenge", amount: 1 },
  { id: "gain-equipment", label: "Gain access to an unusual or powerful piece of equipment", kind: "equipment" },
];

/** Looted items become regular equipment with three uses and one bonus requirement (rulebook p39). */
export const LOOT_DEFAULT_USES = 3;

/**
 * Parse a loot bonus string into a structured requirement. Loot is printed with leading
 * `+` signs for its bonus-die count and the trigger tag after them, e.g. "++anti-tank" →
 * `{ tag: "anti-tank", plus: 2 }`. Returns undefined for blank/garbled input.
 */
export function parseLootBonus(bonus?: string): BonusRequirement | undefined {
  if (!bonus) return undefined;
  // Tag must start with a real (non-+, non-space) character, so "++" with no tag is rejected
  // rather than reading the trailing + as the tag.
  const m = /^(\++)\s*([^+\s].*)$/.exec(bonus.trim());
  if (!m) return undefined;
  const plus = Math.min(4, m[1]!.length) as 1 | 2 | 3 | 4;
  return { tag: m[2]!.trim(), plus };
}
