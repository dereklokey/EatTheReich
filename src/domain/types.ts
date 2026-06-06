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
}

export type Target = Objective | Threat;

/** Context for a declared action — drives GM pool, SPECIAL gating, etc. */
export interface ActionContext {
  stat: Stat;
  /** What kind of thing the primary allocation targets. */
  targetKind: "objective" | "threat";
  /** True when this is the only target of the action (RULES §10 — Elbow Grease). */
  solo: boolean;
  /** Threat ids this action is engaged with (RULES §3 engagement). */
  engagedThreatIds: string[];
  /** GM-confirmed narration tags satisfied this action (e.g. "ranged weapon", "melee"). */
  tags?: string[];
}
