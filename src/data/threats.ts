import type { Threat } from "../domain/types.js";

/**
 * Threat catalog (RULES §3, §8, §12). Standard threats reinforce; Übermenschen
 * (elites) do not. Factory helpers keep `startingAttack` in sync with `attack`.
 *
 * The named threats below are drawn from RULES.md's own worked examples (§12) and
 * the Übermenschen named in §13. Full enemy stat blocks come from the rulebook;
 * ratings/attacks not given there are marked PENDING.
 */

let counter = 0;
const uid = (slug: string): string => `${slug}-${++counter}`;

export function makeThreat(args: {
  name: string;
  rating: number;
  attack: number;
  challenge?: number;
  reinforces?: boolean;
  unlowerableChallenge?: boolean;
  id?: string;
}): Threat {
  return {
    id: args.id ?? uid(args.name.toLowerCase().replace(/\s+/g, "-")),
    name: args.name,
    kind: "threat",
    rating: args.rating,
    attack: args.attack,
    startingAttack: args.attack,
    ...(args.challenge !== undefined ? { challenge: args.challenge } : {}),
    ...(args.unlowerableChallenge ? { unlowerableChallenge: true } : {}),
    reinforces: args.reinforces ?? true,
  };
}

/** Standard rank-and-file threats from RULES §12 examples. */
export const infantrySquad = (): Threat =>
  makeThreat({ name: "Infantry Squad", rating: 6, attack: 3 });

export const policePatrol = (): Threat =>
  makeThreat({ name: "Police Patrol", rating: 4, attack: 2 });

export const naziSquad = (): Threat =>
  makeThreat({ name: "Nazi Squad", rating: 4, attack: 3 }); // golden test A

/**
 * Übermenschen (RULES §13) — the GM's "speaking" villains. They do NOT reinforce;
 * higher starting Attack compensates. Numeric blocks PENDING the rulebook; the
 * roster + their non-ideological characterisation is from §13.
 */
const PENDING_RATING = 8; // placeholder elite rating — replace from rulebook
const PENDING_ATTACK = 4; // placeholder elite attack — replace from rulebook

export const damonenblut = (): Threat =>
  makeThreat({
    name: "Dämonenblut",
    rating: PENDING_RATING,
    attack: PENDING_ATTACK,
    reinforces: false,
  });

export const rustWitch = (): Threat =>
  makeThreat({
    name: "Rust-Witch",
    rating: PENDING_RATING,
    attack: PENDING_ATTACK,
    reinforces: false,
    // Raises the player discard threshold to ≤4 (engine: per-engagement override).
  });

export const stahlsoldat = (): Threat =>
  makeThreat({
    name: "Stahlsoldat",
    rating: PENDING_RATING,
    attack: PENDING_ATTACK,
    reinforces: false,
  });

export const werhund = (): Threat =>
  makeThreat({
    name: "Werhund",
    rating: PENDING_RATING,
    attack: PENDING_ATTACK,
    reinforces: false,
    unlowerableChallenge: true, // RULES §6/§10: Challenge cannot be lowered
  });

export const UBERMENSCHEN_FACTORIES = [
  damonenblut,
  rustWitch,
  stahlsoldat,
  werhund,
] as const;
