import type { Stat, ActionContext } from "./types.js";

/**
 * Character data shapes (RULES §7, §10). The six pregens are fixed; this models
 * the rules-hooks the engine needs. Verbatim numeric stat blocks come from the
 * rulebook and are filled in data/characters.ts as they're transcribed.
 */

/**
 * A condition the engine/GM checks before offering a conditional SPECIAL or bonus
 * (e.g. Chuck's Elbow Grease only on a solo FIX Objective). Any field present must
 * match the ActionContext; absent fields are wildcards.
 */
export interface ActionCondition {
  stat?: Stat;
  targetKind?: "objective" | "threat";
  solo?: boolean;
  /** Free-form tag a GM can require (e.g. "melee", "concealed"). */
  tag?: string;
}

export type SpecialTrigger =
  /** Fires when a critical is allocated to it; `requires` further gates it. */
  | { type: "crit"; requires?: ActionCondition }
  /** Non-crit trigger (e.g. Nicole's Scavenger d6 restore) — engine/GM driven. */
  | { type: "condition"; requires?: ActionCondition };

export interface Special {
  id: string;
  name: string;
  /** Rule-breaking effect text (shown to the table). */
  text: string;
  trigger: SpecialTrigger;
  /** True when locked behind an Advance (drinking Übermensch blood). */
  advanceGated?: boolean;
}

export interface Ability {
  id: string;
  name: string;
  text: string;
  /** Blood cost to use (RULES §7). */
  bloodCost?: number;
  /** Most abilities add a die; some don't (read text). */
  addsDie: boolean;
}

export interface BonusRequirement {
  /** Narration tag that satisfies it (GM-confirmed toggle), e.g. "elevated". */
  tag: string;
  /** Number of `+` symbols → bonus dice granted (1–4). */
  plus: 1 | 2 | 3 | 4;
}

export interface Equipment {
  id: string;
  name: string;
  /** Uses remaining; undefined = unlimited (starter gear). */
  uses?: number;
  /** Bonus dice unlocked when its requirement is narrated & GM-confirmed. */
  bonus?: BonusRequirement;
  /** True if it occupies the single active loot slot (RULES §11). */
  loot?: boolean;
}

export interface CharacterSheet {
  id: string;
  name: string;
  blurb: string;
  /** Base stat ratings (RULES §2). Pending rulebook transcription where 0. */
  stats: Record<Stat, number>;
  abilities: Ability[];
  specials: Special[];
  equipment: Equipment[];
}

/** True when `ctx` satisfies every present field of `cond`. */
export function conditionMet(cond: ActionCondition | undefined, ctx: ActionContext): boolean {
  if (!cond) return true;
  if (cond.stat !== undefined && cond.stat !== ctx.stat) return false;
  if (cond.targetKind !== undefined && cond.targetKind !== ctx.targetKind) return false;
  if (cond.solo !== undefined && cond.solo !== ctx.solo) return false;
  // `tag` is GM-narration-driven; not derivable from ctx alone, so it never
  // auto-passes here — the GM toggles it at the table.
  if (cond.tag !== undefined) return false;
  return true;
}
