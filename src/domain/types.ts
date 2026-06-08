/**
 * Core domain types for the Eat the Reich engine.
 *
 * Source of truth: RULES.md. Anything the engine computes here is a *default* a
 * human (the GM) can override before it commits (CLAUDE.md §0 — "suggest, don't
 * enforce"). These types describe state shapes; the override mechanism lives at
 * the event layer.
 */

// RULES.md §2 — seven stats; an action uses exactly one (or a flat 2 dice if none fit).
export const STATS = [
  "BRAWL",
  "CON",
  "FIX",
  "SEARCH",
  "SHOOT",
  "SNEAK",
  "TERRIFY",
] as const;
export type Stat = (typeof STATS)[number];

/** A single d6 face. */
export type DieFace = 1 | 2 | 3 | 4 | 5 | 6;

// RULES.md §3 — everything in play is mechanically an Objective or a Threat.

/** A goal. Never rolls at the player; never deals damage. Rating 0 = complete. */
export interface Objective {
  id: string;
  name: string;
  kind: "objective";
  /** RULES §3: 2–12 at creation; 0 = complete. */
  rating: number;
  /** RULES §6: negates this many allocated units per vampire per turn before rating drops. */
  challenge?: number;
}

/** An enemy. `rating` and `attack` are INDEPENDENT (RULES §3). */
export interface Threat {
  id: string;
  name: string;
  kind: "threat";
  /** Reduce to 0 to defeat. At 0, attack is forced to 0. */
  rating: number;
  /** The GM's dice pool contribution. Only this makes a Threat dangerous. */
  attack: number;
  /** Original Attack, used by reinforcement's half-reset (RULES §8). */
  startingAttack: number;
  /** RULES §6: soaks allocated units before rating drops. */
  challenge?: number;
  /** Werhund etc.: challenge cannot be lowered. */
  unlowerableChallenge?: boolean;
  /**
   * Participates in end-of-round Attack escalation (+1, and +1 for zero successes
   * — RULES §8). False for "Solo" enemies & most Übermenschen. Note Stahlsoldat is
   * `reinforces: true` BUT `restoresAtZero: false` (escalates, yet dies at 0).
   */
  reinforces: boolean;
  /**
   * When reduced to 0: true → regain 1d6 rating + half-Attack (standard threats);
   * false → removed permanently (Übermenschen, Solo elites, Stahlsoldat).
   * Defaults to `reinforces` when omitted at construction.
   */
  restoresAtZero: boolean;
  /** Player discard threshold override (Rust-Witch raises it to 4). Default 3. */
  discardThreshold?: number;
  /** Named special rule keys the engine/GM applies (e.g. "painless", "anathema"). */
  rules?: string[];
  /**
   * Staging (issue #12): `false` means the GM has placed this Threat but is holding it
   * OUT of play — it's foreshadowed (the Rust-Witch riding the ferris wheel towards you),
   * not yet in the fight. A staged Threat contributes no Attack, soaks nothing, doesn't
   * escalate, imposes no Aura, and is hidden from players until the GM activates it.
   * Omitted/`true` = in play. Threats predating staging have no field → treated in play.
   */
  active?: boolean;
}

/**
 * A Secondary Objective (RULES §5 rescue; rulebook p38). Rated ~half the main
 * Objective. A rescue one is tied to a Downed character; others grant a reward on
 * completion (see data/rewards.ts).
 */
/**
 * Special gear unlocked by completing a Secondary Objective (rulebook p39: "clear the
 * Objective, and you unlock the equipment"). This gear does NOT occupy a Loot slot, so it
 * grants slot-free. `bonus` is the printed (+tag) requirement string (e.g. "+++anti-tank").
 */
export interface RewardItem {
  name: string;
  bonus?: string;
  note?: string;
}

export interface SecondaryObjective {
  id: string;
  name: string;
  kind: "secondary";
  rating: number;
  challenge?: number;
  /** Set when this is a Downed-rescue objective. */
  rescueFor?: string;
  /** Chosen reward id once completed. */
  rewardChoice?: string;
  /** Gear this objective unlocks on completion (slot-free). Drives the GM gate (issue #4). */
  rewardEquipment?: RewardItem[];
  /**
   * Staged reveal (issue #15): `false` means the GM has placed this Secondary but is holding
   * it back — hidden from players until revealed, mirroring a staged Threat. Omitted/`true` =
   * visible. Scene-loaded secondaries default to `false`; rescue + manually-added ones default
   * visible (no field). Legacy secondaries with no field are treated as visible.
   */
  revealed?: boolean;
}

/**
 * A Threat is "in play" — contributing Attack to the Reich pool, soaking allocated units,
 * escalating at end of round, imposing its Aura — only when it still has rating AND the GM
 * has it activated (issue #12). Staged Threats (`active === false`) sit out of the fight
 * until revealed. The single source of truth for "is this Threat on the battlefield right
 * now"; used by the GM-pool builder, reinforcements, the discard threshold, and the board.
 */
export function threatInPlay(t: Threat): boolean {
  return t.rating > 0 && t.active !== false;
}

/**
 * Einherjar 'Bloodless' (rulebook p55, issue #20): a PC cannot spend dice to regain Blood
 * while engaged ONLY with the Einherjar. This app has no per-PC engagement model — the Reich
 * pool is a board property (issue #8) — so "engaged only with it" reads as: every Threat in
 * play is a 'bloodless' one. The moment any non-bloodless Threat is also in play (a Tank rolls
 * up, say), the PC is engaged with more than the Einherjar and Feed opens back up. A
 * staged/defeated Einherjar imposes nothing (gated on {@link threatInPlay}, mirroring the
 * Aura/Painless treatment). Pure board predicate — the same call drives the client Feed gate
 * and any server check, so they never disagree.
 */
export function feedBlockedByBloodless(threats: readonly Threat[]): boolean {
  const inPlay = threats.filter(threatInPlay);
  return inPlay.length > 0 && inPlay.every((t) => (t.rules ?? []).includes("bloodless"));
}

/**
 * Vampirjäger Cadre 'Anathema' (rulebook p64, issue #21) is in force: while it's in play, each
 * GM Attack die showing a 6 scores 2 successes (the boost itself lives in engine
 * {@link import("../engine/dice.js").gmSuccessTally}). Like Painless/Aura it's a board property
 * (issue #8: the Reich pool carries no per-Threat attribution), so it rides the whole aggregate
 * roll. Gated on {@link threatInPlay} — a staged (#12) or defeated Cadre imposes nothing. The
 * one predicate drives the server count and the client readouts, so they never disagree.
 */
export function anathemaInPlay(threats: readonly Threat[]): boolean {
  return threats.some((t) => threatInPlay(t) && (t.rules ?? []).includes("anathema"));
}

/**
 * Werhund 'Rending Claws' (rulebook p64, issue #24) is in force: while it's in play, a normal
 * Injury the table attributes to it marks ALL boxes in the rolled category (the escalation
 * itself lives in engine {@link import("../engine/injury.js").rendInjury}). Like Painless/
 * Anathema it's a board property (issue #8: the Reich pool carries no per-Threat attribution),
 * so the option to rend a wound only appears while a Werhund is on the battlefield. Gated on
 * {@link threatInPlay} — a staged (#12) or defeated Werhund offers nothing. The one predicate
 * drives the injury-beat button and the server's gate on the `rending` flag, so they agree.
 */
export function rendingClawsInPlay(threats: readonly Threat[]): boolean {
  return threats.some((t) => threatInPlay(t) && (t.rules ?? []).includes("rending-claws"));
}

export type Target = Objective | Threat;

/**
 * Werhund 'Unlowerable Challenge' (rulebook p64, issue #25): its Challenge cannot be lowered.
 * THE single predicate that consumes the `unlowerableChallenge` field — the board flags the
 * lock (the `message`) and every Challenge-reduction effect (Sapper #29, Tethered Phantom /
 * Hellish Screech #35, the −1-Challenge secondary reward #37) MUST gate on it via
 * {@link import("../engine/challenge.js").lowerChallenge}, so the block lives in one place
 * rather than re-checked per effect. Objectives are never unlowerable; only a flagged Threat is.
 * NOTE: this gates *effects*, not the GM's manual Stepper edit — §0 "suggest, don't enforce"
 * lets the GM override anything, including dropping a Werhund's Challenge by hand.
 */
export function isChallengeUnlowerable(target: Target): boolean {
  return target.kind === "threat" && target.unlowerableChallenge === true;
}

/** Context for a declared action — drives GM pool, SPECIAL gating, etc. */
export interface ActionContext {
  stat: Stat;
  /** What kind of thing the primary allocation targets. */
  targetKind: "objective" | "threat";
  /** True when this is the only target of the action (RULES §10 — Elbow Grease). */
  solo: boolean;
  /** GM-confirmed narration tags satisfied this action (e.g. "ranged weapon", "melee"). */
  tags?: string[];
}
