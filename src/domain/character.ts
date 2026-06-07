import type { Stat, ActionContext } from "./types.js";

/**
 * Character data shapes (rulebook pp. 14–24; mechanics pp. 30–41). The six pregens
 * are fixed. Numeric values here are transcribed from the printed character sheets
 * — the rulebook is the source of truth (per the project owner).
 */

/**
 * A condition the engine/GM checks before offering a conditional SPECIAL/ability
 * (e.g. Chuck's Elbow Grease only on a solo FIX Objective). Any present field must
 * match the ActionContext; absent fields are wildcards. A `tag` requirement is
 * satisfied when the GM has flagged that tag on the action (ctx.tags).
 */
export interface ActionCondition {
  stat?: Stat;
  targetKind?: "objective" | "threat";
  solo?: boolean;
  /** Free-form narration tag the GM confirms, e.g. "ranged weapon", "melee", "explosives". */
  tag?: string;
}

export type SpecialTrigger =
  /** Fires when a critical is allocated to it; `requires` further gates it. */
  | { type: "crit"; requires?: ActionCondition }
  /** Automatic / non-crit (e.g. passives, or "when you reduce a Threat to 0"). */
  | { type: "condition"; requires?: ActionCondition };

/** Bonus requirement: narration tag → bonus dice (number of `+` symbols, 1–4). */
export interface BonusRequirement {
  tag: string;
  plus: 1 | 2 | 3 | 4;
}

export type PowerMechanic =
  /** Spend Blood to do a thing; adds a die when used (most abilities). */
  | "active"
  /** Rule-breaking SPECIAL, activated by allocating a critical (RULES p33). */
  | "special"
  /** Automatic effect (e.g. pre-discard passive). Engine handles by `id`. */
  | "passive";

/** Unified ability/advance entry. */
export interface Power {
  id: string;
  name: string;
  text: string;
  mechanic: PowerMechanic;
  /** Blood spent to activate (active powers; some specials). */
  bloodCost?: number;
  /**
   * False for effect/stance/setup actives that add NO pool die — they reduce a
   * Challenge, transform you, or buff a *future* action (RULES §4 "some abilities add
   * no die"). Such powers are used from the sheet, not folded into the dice pool.
   * Default true.
   */
  addsDie?: boolean;
  /** A (+tag) bonus requirement printed on the power itself. */
  bonus?: BonusRequirement;
  /** For specials/conditionals: when it fires and any gating condition. */
  trigger?: SpecialTrigger;
  /**
   * Blood gained when this SPECIAL is activated (a crit allocated to it) — e.g. Flint's
   * Ravenous (+3). A pure self-buff the engine can apply directly; most other SPECIALs
   * need a target the table picks and stay GM-adjudicated. Applied as a logged BLOOD_CHANGED
   * (a default the GM can still edit, CLAUDE.md §0).
   */
  grantsBlood?: number;
}

export interface Equipment {
  id: string;
  name: string;
  /** Uses remaining; undefined = unlimited / starter gear with no use track. */
  uses?: number;
  /**
   * False for reactive/economy items used OUTSIDE pool-building — at resolution
   * (Chuck's hat → mark to ignore an Injury) or anytime (Iryna's cigarettes → regain
   * Blood). These contribute no pool die and are used from the sheet. Default true.
   */
  addsDie?: boolean;
  /** Bonus dice unlocked when its requirement is narrated & GM-confirmed. */
  bonus?: BonusRequirement;
  /** Nicole's weapons carry a [1]..[6] id for Scavenger matching. */
  scavengerSlot?: number;
  /** Free-form note for non-die effects (e.g. "mark to regain 2 Blood"). */
  note?: string;
  /**
   * Resolution-time reactive effect (RULES §5; surfaced in the INJURY_CHECK window).
   * `ignoreInjury` lets the item be marked to shrug off a pending Injury/Downed (Chuck's
   * hat). `blood` is regained automatically when the item is used (Iryna's cigarettes).
   */
  reactive?: { ignoreInjury?: boolean; blood?: number };
  /** True if it occupies the single active loot slot (RULES §11). */
  loot?: boolean;
}

export interface InjuryBox {
  label: string;
  /** Mechanical penalty (present on the 2nd box of a category). */
  penalty?: string;
}

/** One injury category = 2 d6 faces + 2 boxes (RULES §5; sheets pp. 14–24). */
export interface InjuryCategory {
  faces: [number, number];
  boxes: [InjuryBox, InjuryBox];
}

export interface CharacterSheet {
  id: string;
  name: string;
  blurb: string;
  /** The character-concept hook lines from the sheet. */
  hooks: string[];
  stats: Record<Stat, number>;
  equipment: Equipment[];
  /** Available from the start (RULES §7). */
  abilities: Power[];
  /** Locked until the player drinks Übermensch blood (RULES §7). */
  advances: Power[];
  /** 3 categories × 2 boxes. */
  injuries: [InjuryCategory, InjuryCategory, InjuryCategory];
  lastStand: string;
}

/** True when `ctx` satisfies every present field of `cond`. */
export function conditionMet(cond: ActionCondition | undefined, ctx: ActionContext): boolean {
  if (!cond) return true;
  if (cond.stat !== undefined && cond.stat !== ctx.stat) return false;
  if (cond.targetKind !== undefined && cond.targetKind !== ctx.targetKind) return false;
  if (cond.solo !== undefined && cond.solo !== ctx.solo) return false;
  if (cond.tag !== undefined && !(ctx.tags ?? []).includes(cond.tag)) return false;
  return true;
}

/** All crit-activated SPECIALs on a sheet, tagged with whether they're advance-gated. */
export function specialsOf(
  character: CharacterSheet,
): Array<{ power: Power; advanceGated: boolean }> {
  return [
    ...character.abilities.map((power) => ({ power, advanceGated: false })),
    ...character.advances.map((power) => ({ power, advanceGated: true })),
  ].filter(({ power }) => power.mechanic === "special");
}
