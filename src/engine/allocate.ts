import type { Objective, Threat } from "../domain/types.js";
import { isBoardSpecialId } from "./specials.js";

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
  /**
   * Flat rating damage a sheet SPECIAL inflicts on `targetId` — a Threat (Astrid's Apex Predator
   * → 3, RULES §7 / issue #27) or an Objective (Chuck's Elbow Grease → 4, issue #30). Bypasses
   * Challenge (not a normal allocated-die hit); a Threat at rating 0 → Attack 0. The counterpart to
   * how a board-granted Crash & Burn (#23) carries its damage in `units`; a sheet special carries it
   * here so a crit's own 2 units stay distinct from the effect.
   */
  ratingDamage?: number;
  /**
   * GM Attack dice a targetless SPECIAL knocks off this turn (Astrid's Unnatural Endurance → 3,
   * RULES §7 / issue #28) — a crit-activated "big Defend" applied to `gmDiceRemaining` (clamped
   * ≥0), independent of the crit's own 2 units. Carried here so a `special` allocation can shed
   * GM dice without a board target.
   */
  gmDiceReduction?: number;
  /**
   * Which of the acting vampire's own Injury categories a healing SPECIAL clears (Astrid's Nightmare
   * Regeneration, RULES §7 / issue #31). The crit aims INWARD, not at the board, so this carries the
   * player's chosen wound rather than a `targetId`; the handler resolves the marked box from the live
   * track and emits HEALED. {@link applyOneAllocation} ignores it — the heal mutates the character's
   * injury track (held off the board), never the Objective/Threat accumulator the engine folds.
   */
  injuryCategory?: 0 | 1 | 2;
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
  /**
   * Extra Challenge a target soaks THIS turn beyond its printed value, keyed by target id.
   * The Einherjar's 'Painless' (rulebook p55) raises its Challenge by the number of 1s in the
   * Reich's Attack roll for this action; the engine records the raise as an event and threads
   * the amount through here so the allocation soak matches. Per-turn — a fresh turn drops it.
   */
  challengeBump?: Record<string, number>;
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
  challengeBump?: Record<string, number>,
): AllocationAccumulator {
  return {
    board: cloneBoard(board),
    gmDiceRemaining: gmDiceCount,
    bloodGained: 0,
    challengeConsumed: {},
    specialsActivated: [],
    ...(challengeBump ? { challengeBump } : {}),
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
    ...(acc.challengeBump ? { challengeBump: acc.challengeBump } : {}),
  };

  const absorbChallenge = (id: string, declared: number | undefined, units: number): number => {
    // Printed Challenge + any per-turn raise (Einherjar 'Painless') is the soak this target gets.
    const cap = (declared ?? 0) + (next.challengeBump?.[id] ?? 0);
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
    case "special": {
      if (a.specialId) next.specialsActivated.push(a.specialId);
      // Flat rating damage from a SPECIAL — inflicted directly on `targetId`, independent of the
      // crit's own 2 units and bypassing Challenge (it's not a normal allocated-die hit). For a
      // Threat: rating 0 → Attack 0 (RULES §3), same as eliminate. For an Objective: flat progress,
      // rating clamped at 0 (Chuck's Elbow Grease, #30). A board-granted Crash & Burn (#23) carries
      // it in `units` behind a namespaced id; a sheet special (Apex Predator #27 / Elbow Grease #30)
      // carries it in `ratingDamage` and the engine applies it to whichever board entity it names.
      const dmg = (a.ratingDamage ?? 0) + (isBoardSpecialId(a.specialId) ? a.units : 0);
      if (dmg > 0 && a.targetId) {
        const thr = next.board.threats.find((t) => t.id === a.targetId);
        if (thr) {
          thr.rating = Math.max(0, thr.rating - dmg);
          if (thr.rating === 0) thr.attack = 0;
        } else {
          const obj = next.board.objectives.find((o) => o.id === a.targetId);
          if (obj) obj.rating = Math.max(0, obj.rating - dmg);
        }
      }
      // A targetless "big Defend" SPECIAL (Unnatural Endurance, #28) sheds GM Attack dice this turn,
      // exactly like a Defend allocation but independent of the crit's units. Clamped ≥0.
      if (a.gmDiceReduction) next.gmDiceRemaining = Math.max(0, next.gmDiceRemaining - a.gmDiceReduction);
      break;
    }
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
