import type { Objective, Threat } from "../domain/types.js";

/**
 * ALLOCATE (RULES §4). Each surviving die is assigned to exactly one target.
 * Success = 1 unit, crit = 2 units (or one SPECIAL). A die carries an optional
 * narrated detail (not modelled here — it lives at the event layer).
 *
 * Targets:
 *  - advance   : −rating on an Objective (challenge absorbs first, RULES §6)
 *  - eliminate : −rating on a Threat (challenge absorbs first; rating 0 → Attack 0)
 *  - defend    : remove GM Attack dice (the ONLY way GM dice get cancelled)
 *  - feed      : +Blood (cap 10)
 *  - special   : activate a SPECIAL (criticals only) — handled by specials.ts
 */
export type AllocationKind =
  | "advance"
  | "eliminate"
  | "defend"
  | "feed"
  | "special";

export interface Allocation {
  kind: AllocationKind;
  /** Objective/Threat id for advance|eliminate. Omitted for defend|feed|special. */
  targetId?: string;
  /** Units from the die: success = 1, crit = 2. */
  units: number;
  /** SPECIAL id for `kind: "special"`. */
  specialId?: string;
}

export interface BoardState {
  objectives: Objective[];
  threats: Threat[];
}

export interface AllocationResult {
  board: BoardState;
  /** GM Attack dice remaining after Defend allocations (drives INJURY_CHECK). */
  gmDiceRemaining: number;
  /** Net Blood gained this turn from Feed allocations. */
  bloodGained: number;
  /** SPECIAL ids activated (crit allocations to `special`). */
  specialsActivated: string[];
}

const clone = (b: BoardState): BoardState => ({
  objectives: b.objectives.map((o) => ({ ...o })),
  threats: b.threats.map((t) => ({ ...t })),
});

/**
 * Apply a turn's allocations to the board.
 *
 * Challenge (RULES §6) is per-target, per-vampire, per-turn: it negates up to
 * `challenge` units across this turn's allocations to that target before its
 * rating drops. We track a per-target absorb budget that depletes within the turn
 * and resets next turn (callers invoke this once per turn).
 *
 * `gmDiceCount` is the number of GM successful Attack dice going into ALLOCATE.
 */
export function applyAllocations(
  board: BoardState,
  allocations: readonly Allocation[],
  gmDiceCount: number,
): AllocationResult {
  const next = clone(board);
  const objectivesById = new Map(next.objectives.map((o) => [o.id, o]));
  const threatsById = new Map(next.threats.map((t) => [t.id, t]));

  // Remaining challenge buffer per target for THIS turn.
  const challengeLeft = new Map<string, number>();
  const challengeFor = (id: string, declared: number | undefined): number => {
    if (!challengeLeft.has(id)) challengeLeft.set(id, declared ?? 0);
    return challengeLeft.get(id) ?? 0;
  };

  let gmDiceRemaining = gmDiceCount;
  let bloodGained = 0;
  const specialsActivated: string[] = [];

  for (const a of allocations) {
    switch (a.kind) {
      case "advance": {
        const obj = a.targetId ? objectivesById.get(a.targetId) : undefined;
        if (!obj) break;
        const absorb = Math.min(a.units, challengeFor(obj.id, obj.challenge));
        challengeLeft.set(obj.id, challengeFor(obj.id, obj.challenge) - absorb);
        obj.rating = Math.max(0, obj.rating - (a.units - absorb));
        break;
      }
      case "eliminate": {
        const thr = a.targetId ? threatsById.get(a.targetId) : undefined;
        if (!thr) break;
        const absorb = Math.min(a.units, challengeFor(thr.id, thr.challenge));
        challengeLeft.set(thr.id, challengeFor(thr.id, thr.challenge) - absorb);
        thr.rating = Math.max(0, thr.rating - (a.units - absorb));
        if (thr.rating === 0) thr.attack = 0; // RULES §3: rating 0 → Attack 0
        break;
      }
      case "defend":
        // Removes GM Attack dice: 1 per success unit, 2 per crit (units carries it).
        gmDiceRemaining = Math.max(0, gmDiceRemaining - a.units);
        break;
      case "feed":
        bloodGained += a.units; // cap applied by caller against current Blood
        break;
      case "special":
        if (a.specialId) specialsActivated.push(a.specialId);
        break;
    }
  }

  return { board: next, gmDiceRemaining, bloodGained, specialsActivated };
}

/** Clamp a Blood total to the 0–10 range (RULES §5). */
export function clampBlood(blood: number): number {
  return Math.max(0, Math.min(10, blood));
}
