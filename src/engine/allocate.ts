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

/**
 * Running state while allocating a single turn's dice. Held by the caller (engine
 * batch, or the reducer across DIE_ALLOCATED events) so Challenge (RULES §6) can
 * deplete per-target across the turn and reset next turn.
 */
export interface AllocationAccumulator {
  board: BoardState;
  /** GM Attack dice remaining after Defend (drives INJURY_CHECK). */
  gmDiceRemaining: number;
  /** Net Blood gained from Feed this turn. */
  bloodGained: number;
  /** Challenge units already absorbed per target id this turn. */
  challengeConsumed: Record<string, number>;
  /** SPECIAL ids activated (crit allocations to `special`). */
  specialsActivated: string[];
}

export interface AllocationResult {
  board: BoardState;
  gmDiceRemaining: number;
  bloodGained: number;
  specialsActivated: string[];
}

const cloneBoard = (b: BoardState): BoardState => ({
  objectives: b.objectives.map((o) => ({ ...o })),
  threats: b.threats.map((t) => ({ ...t })),
});

export function emptyAccumulator(
  board: BoardState,
  gmDiceCount: number,
): AllocationAccumulator {
  return {
    board: cloneBoard(board),
    gmDiceRemaining: gmDiceCount,
    bloodGained: 0,
    challengeConsumed: {},
    specialsActivated: [],
  };
}

/**
 * Apply ONE allocation to an accumulator, returning a NEW accumulator. Pure; the
 * reducer calls this per DIE_ALLOCATED event, the engine batch calls it in a fold.
 */
export function applyOneAllocation(
  acc: AllocationAccumulator,
  a: Allocation,
): AllocationAccumulator {
  const next: AllocationAccumulator = {
    board: cloneBoard(acc.board),
    gmDiceRemaining: acc.gmDiceRemaining,
    bloodGained: acc.bloodGained,
    challengeConsumed: { ...acc.challengeConsumed },
    specialsActivated: [...acc.specialsActivated],
  };

  const absorbChallenge = (id: string, declared: number | undefined, units: number): number => {
    const cap = declared ?? 0;
    const used = next.challengeConsumed[id] ?? 0;
    const absorb = Math.min(units, Math.max(0, cap - used));
    next.challengeConsumed[id] = used + absorb;
    return absorb;
  };

  switch (a.kind) {
    case "advance": {
      const obj = a.targetId ? next.board.objectives.find((o) => o.id === a.targetId) : undefined;
      if (obj) {
        const absorb = absorbChallenge(obj.id, obj.challenge, a.units);
        obj.rating = Math.max(0, obj.rating - (a.units - absorb));
      }
      break;
    }
    case "eliminate": {
      const thr = a.targetId ? next.board.threats.find((t) => t.id === a.targetId) : undefined;
      if (thr) {
        const absorb = absorbChallenge(thr.id, thr.challenge, a.units);
        thr.rating = Math.max(0, thr.rating - (a.units - absorb));
        if (thr.rating === 0) thr.attack = 0; // RULES §3: rating 0 → Attack 0
      }
      break;
    }
    case "defend":
      next.gmDiceRemaining = Math.max(0, next.gmDiceRemaining - a.units);
      break;
    case "feed":
      next.bloodGained += a.units;
      break;
    case "special":
      if (a.specialId) next.specialsActivated.push(a.specialId);
      break;
  }

  return next;
}

/** Apply a whole turn's allocations at once (engine batch path / tests). */
export function applyAllocations(
  board: BoardState,
  allocations: readonly Allocation[],
  gmDiceCount: number,
): AllocationResult {
  const acc = allocations.reduce(
    (a, alloc) => applyOneAllocation(a, alloc),
    emptyAccumulator(board, gmDiceCount),
  );
  return {
    board: acc.board,
    gmDiceRemaining: acc.gmDiceRemaining,
    bloodGained: acc.bloodGained,
    specialsActivated: acc.specialsActivated,
  };
}

/** Clamp a Blood total to the 0–10 range (RULES §5). */
export function clampBlood(blood: number): number {
  return Math.max(0, Math.min(10, blood));
}
