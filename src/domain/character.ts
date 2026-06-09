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
  /**
   * How much this SPECIAL reduces a chosen Threat's Attack rating when activated (a crit
   * allocated to it WITH a target Threat) — Iryna's Deadeye Shot / Cosgrave's Back-Pocket Hex
   * (both −1, rulebook pp51/57). Unlike {@link grantsBlood} (a self-buff), this needs the
   * table to pick the Threat, so it rides on the `special` allocation's `targetId`. The handler
   * applies it as a logged THREAT_ATTACK_REDUCED (a default the GM can still edit, CLAUDE.md §0).
   */
  reduceThreatAttack?: number;
  /**
   * Flat amount this SPECIAL knocks off a chosen Threat's *rating* when activated (a crit on it
   * WITH a target Threat) — Astrid's Apex Predator (−3, rulebook p57). Like a board-granted
   * Crash & Burn hit it's direct damage: it bypasses Challenge (not a normal attack) and rides
   * the `special` allocation as `ratingDamage`, so it folds through the same engine path and the
   * client preview reflects it. rating 0 → Attack 0 (RULES §3). A GM-editable default (§0).
   */
  reduceThreatRating?: number;
  /**
   * Flat amount this SPECIAL knocks off a chosen Objective's *rating* when activated (a crit on it
   * WITH a target Objective) — Chuck's Elbow Grease (−4, rulebook p52, "take on an Objective
   * single-handed with FIX"). The Objective counterpart of {@link reduceThreatRating}: like Apex
   * Predator it's flat direct progress that bypasses Challenge (not a normal allocated-die advance),
   * and rides the `special` allocation as the same `ratingDamage` the engine applies to whichever
   * board entity `targetId` names. A GM-editable default (§0).
   */
  reduceObjectiveRating?: number;
  /**
   * How many of the GM's surviving Attack dice this SPECIAL knocks off this turn — Astrid's
   * Unnatural Endurance (−3, rulebook p57). A targetless, crit-activated "big Defend": it rides
   * the `special` allocation as `gmDiceReduction` and folds through the engine's `gmDiceRemaining`
   * (clamped ≥0), so the client's incoming-Attack preview drops live. A GM-editable default (§0).
   */
  reduceGmDice?: number;
  /**
   * How much this SPECIAL lowers a chosen Objective- OR Threat's Challenge when activated (a crit
   * on it WITH a target) — Nicole's Sapper (−1, rulebook p59, "when you use explosives"). Unlike the
   * rating/Attack cuts this can aim at EITHER board kind, so it rides on the `special` allocation's
   * `targetId`; the handler routes the drop through the engine's
   * {@link import("../engine/challenge.js").lowerChallenge} chokepoint, so the Werhund's 'Unlowerable
   * Challenge' (#25) is respected. Applied as a logged, GM-editable CHALLENGE_REDUCED (CLAUDE.md §0).
   */
  reduceChallenge?: number;
  /**
   * True for a SPECIAL that clears one of the acting vampire's own marked Injury boxes — Astrid's
   * Nightmare Regeneration (rulebook p55, issue #31). Unlike the rating/Attack/Challenge cuts this
   * aims INWARD: a crit on it, with a chosen injury category (`Allocation.injuryCategory`), heals the
   * highest marked box in that category. The handler resolves the box from the live track
   * (server-authoritative — the client can't name an unmarked box) and emits a logged, GM-editable
   * HEALED (CLAUDE.md §0); an unmarked category emits nothing, so it can't mint a phantom heal.
   */
  clearsInjury?: boolean;
  /**
   * True for a SPECIAL that, when activated (a crit allocated to it), throws a salvage d6 to restore
   * one use of a numbered weapon — Nicole's Scavenger (rulebook, Nicole sheet; issue #32). Unlike the
   * other crit-SPECIALs this resolves through its OWN player-driven beat in the resolution theater
   * (the `scavenge` intent) rather than the lock-in fold: the player throws the die in the arena, the
   * SERVER rolls it (anti-fudge, replayable), and the face maps to the weapon carrying that
   * {@link Equipment.scavengerSlot}, whose use the reducer restores. The crit itself still commits as a
   * normal `special` allocation. A GM-editable default (the rolled SCAVENGER_ROLLED event, §0).
   */
  scavenges?: boolean;
  /**
   * Blood gained when the acting vampire reduces a Threat's rating to 0 — Nicole's Feed on Fear
   * (+3, rulebook, Nicole advance; issue #33). A triggered PASSIVE, not a crit-SPECIAL: it isn't
   * allocated to. The handler pays it at the action's conclusion (`commit` / TURN_END) for every
   * Threat this turn's allocations brought to 0, as a logged, GM-editable BLOOD_CHANGED (CLAUDE.md
   * §0) — mirroring {@link grantsBlood}'s self-buff, but keyed to the kill rather than the crit.
   */
  bloodOnThreatKill?: number;
  /**
   * Flat rating a triggered PASSIVE knocks off a Threat the actor names when they MARK an Injury —
   * Chuck's Corrosive Fluids (−2, rulebook, Chuck advance; issue #34). Like {@link bloodOnThreatKill}
   * it isn't allocated to: the handler fires it from the `resolve_injury` path, the moment an
   * INJURY_MARKED lands, against a chosen in-play Threat (`resolve_injury.corrosiveTargetId`). Direct
   * damage like Apex Predator — it bypasses Challenge and rating 0 → Attack 0 (RULES §3) — but landed
   * as its own logged, GM-editable THREAT_RATING_REDUCED (CLAUDE.md §0), not a crit's `ratingDamage`.
   */
  reduceThreatRatingOnInjury?: number;
  /**
   * A no-die ACTIVE that lowers a chosen target's Challenge from the sheet, outside the dice pool —
   * Astrid's Tethered Phantom (an Objective OR Threat, −1, until the end of the round; rulebook p57) and
   * Flint's Hellish Screech (a Threat, −1, permanent; rulebook p63). Issue #35; both are `addsDie:false`
   * advances. Unlike Sapper's {@link reduceChallenge} (a crit-allocated SPECIAL folded through ALLOCATE),
   * this fires from a `use_power` intent: the handler spends `bloodCost`, routes the −`amount` through the
   * engine's {@link import("../engine/challenge.js").lowerChallenge} chokepoint (so the Werhund's
   * 'Unlowerable Challenge' #25 holds), and emits a logged, GM-editable CHALLENGE_REDUCED (CLAUDE.md §0).
   * `scope` limits which board kind the picked target may be; `expiresAtRoundEnd` flags Tethered Phantom's
   * drop to be handed back at ROUND_ENDED (carried meanwhile as the target's `tempChallengeReduction`).
   */
  sheetChallengeReduction?: { amount: number; scope: "threat" | "objective_or_threat"; expiresAtRoundEnd?: boolean };
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
