import type { Threat } from "../domain/types.js";

/**
 * Threat catalog, transcribed from the rulebook: Common Enemies (p61), the named
 * Übermenschen (pp. 52–64), and the Einherjar (p55). The rulebook is the source of
 * truth.
 *
 * Reinforcement model (RULES §8, rulebook p38):
 *  - `reinforces`     — gets end-of-round Attack escalation (+1; +1 more for zero
 *                       successes). False for "Solo" enemies and most Übermenschen.
 *  - `restoresAtZero` — at rating 0, regains 1d6 rating + half-Attack (standard
 *                       threats) vs removed permanently (Solo/Übermenschen).
 *  Stahlsoldat is the notable hybrid: reinforces (escalates) yet dies at 0.
 *
 * Named special-rule keys (in `rules`) are engine/GM hooks; legend below.
 */

// Special-rule legend (rulebook):
//  "solo"            — does not use the Reinforcement rules (encoded via flags too)
//  "painless"        — Einherjar: each GM Attack die showing 1 raises its Challenge by 1 this action
//  "bloodless"       — Einherjar: PCs can't spend dice to regain Blood while engaged ONLY with it
//  "anathema"        — Vampirjäger: GM Attack dice score 2 successes each on a 6
//  "rapid-deployment"— Paratrooper: when Attack +1 via Reinforcement, also +2 rating
//  "crash-and-burn"  — Motorcycle Squad: grants all engaged vampires a "deal 3 to it" SPECIAL
//  "powering-up"     — Stahlsoldat: reinforces normally but is defeated at 0
//  "aura-of-misfortune" — Rust-Witch: players discard 1–4 (discardThreshold 4)
//  "rust-curse"      — Rust-Witch: end of round, one random item of a chosen PC degrades
//  "rending-claws"   — Werhund: an Injury from it marks ALL boxes in the rolled category
export const THREAT_RULES = {
  SOLO: "solo",
  PAINLESS: "painless",
  BLOODLESS: "bloodless",
  ANATHEMA: "anathema",
  RAPID_DEPLOYMENT: "rapid-deployment",
  CRASH_AND_BURN: "crash-and-burn",
  POWERING_UP: "powering-up",
  AURA_OF_MISFORTUNE: "aura-of-misfortune",
  RUST_CURSE: "rust-curse",
  RENDING_CLAWS: "rending-claws",
} as const;

let counter = 0;
const uid = (slug: string): string => `${slug}-${++counter}`;

export interface ThreatSpec {
  name: string;
  rating: number;
  attack: number;
  challenge?: number;
  unlowerableChallenge?: boolean;
  reinforces?: boolean;
  /** Defaults to `reinforces` when omitted. */
  restoresAtZero?: boolean;
  discardThreshold?: number;
  rules?: string[];
  id?: string;
}

export function makeThreat(spec: ThreatSpec): Threat {
  const reinforces = spec.reinforces ?? true;
  return {
    id: spec.id ?? uid(spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")),
    name: spec.name,
    kind: "threat",
    rating: spec.rating,
    attack: spec.attack,
    startingAttack: spec.attack,
    ...(spec.challenge !== undefined ? { challenge: spec.challenge } : {}),
    ...(spec.unlowerableChallenge ? { unlowerableChallenge: true } : {}),
    reinforces,
    restoresAtZero: spec.restoresAtZero ?? reinforces,
    ...(spec.discardThreshold !== undefined ? { discardThreshold: spec.discardThreshold } : {}),
    ...(spec.rules ? { rules: spec.rules } : {}),
  };
}

// ── Common Enemies (rulebook p61) ───────────────────────────────────────────
export const policePatrol = (): Threat => makeThreat({ name: "Police Patrol", rating: 4, attack: 2 });
export const infantrySquad = (): Threat => makeThreat({ name: "Infantry Squad", rating: 6, attack: 3 });
export const armouredInfantrySquad = (): Threat => makeThreat({ name: "Armoured Infantry Squad", rating: 6, attack: 3, challenge: 1 });
export const sniperTeam = (): Threat => makeThreat({ name: "Sniper Team", rating: 3, attack: 6, challenge: 2, reinforces: false, rules: ["solo"] });
export const armouredCar = (): Threat => makeThreat({ name: "Armoured Car", rating: 4, attack: 2, challenge: 1, reinforces: false, rules: ["solo"] });
export const paratrooperSquad = (): Threat => makeThreat({ name: "Paratrooper Squad", rating: 6, attack: 3, rules: ["rapid-deployment"] });
export const motorcycleSquad = (): Threat => makeThreat({ name: "Motorcycle Squad", rating: 10, attack: 3, rules: ["crash-and-burn"] });
export const tank = (): Threat => makeThreat({ name: "Tank", rating: 8, attack: 6, challenge: 2, reinforces: false, rules: ["solo"] });
export const vampirjagerCadre = (): Threat => makeThreat({ name: "Vampirjäger Cadre", rating: 8, attack: 6, reinforces: false, rules: ["anathema", "solo"] });

/** Standard rank-and-file used in RULES §12 golden test A. */
export const naziSquad = (): Threat => makeThreat({ name: "Nazi Squad", rating: 4, attack: 3 });

// ── Special location enemy (rulebook p55) ───────────────────────────────────
export const einherjar = (): Threat => makeThreat({ name: "Einherjar", rating: 7, attack: 3, rules: ["painless", "bloodless"] });

// ── Übermenschen (rulebook pp. 52–64) — do not reinforce; higher Attack ──────
export const stahlsoldat = (): Threat =>
  // Hybrid: escalates like a normal threat (reinforces) but dies at 0 (restoresAtZero false).
  makeThreat({ name: "Stahlsoldat", rating: 6, attack: 4, challenge: 2, reinforces: true, restoresAtZero: false, rules: ["powering-up"] });

export const rustWitch = (): Threat =>
  makeThreat({ name: "Rust-Witch", rating: 10, attack: 6, reinforces: false, discardThreshold: 4, rules: ["solo", "aura-of-misfortune", "rust-curse"] });

export const damonenblut = (): Threat =>
  makeThreat({ name: "Dämonenblut", rating: 12, attack: 4, challenge: 1, reinforces: false, rules: ["solo"] });

export const werhund = (): Threat =>
  makeThreat({ name: "Werhund", rating: 10, attack: 5, challenge: 1, unlowerableChallenge: true, reinforces: false, rules: ["solo", "rending-claws"] });

export const COMMON_ENEMY_FACTORIES = [
  policePatrol, infantrySquad, armouredInfantrySquad, sniperTeam, armouredCar,
  paratrooperSquad, motorcycleSquad, tank, vampirjagerCadre, einherjar,
] as const;

export const UBERMENSCHEN_FACTORIES = [stahlsoldat, rustWitch, damonenblut, werhund] as const;
