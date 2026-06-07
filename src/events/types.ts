import type {
  DieFace,
  Objective,
  Threat,
  SecondaryObjective,
  Stat,
} from "../domain/types.js";
import type { Equipment } from "../domain/character.js";
import type { AllocationKind } from "../engine/allocate.js";
import type { PoolSource } from "../engine/playerPool.js";
import type { InjuryOutcome } from "../engine/injury.js";
import type { ReinforceLogEntry } from "../engine/reinforcements.js";

/**
 * Event taxonomy (CLAUDE.md §3.2). State = reduce(events). Every mutation is an
 * appended, immutable event carrying {id, gameId, seq, actor, ts, type, payload}.
 *
 * Server-authoritative (§3.1): the server validates intents, rolls dice, and
 * computes results, then appends events. **Computed randomness is captured in the
 * event** (DICE_ROLLED.results, REINFORCEMENTS_APPLIED.threats) so replay is
 * deterministic and never re-rolls.
 *
 * NOT events (transient, never logged): HEARTBEAT and presence/online status (§3A).
 */

export const CHAR_IDS = ["iryna", "nicole", "cosgrave", "chuck", "astrid", "flint"] as const;
export type CharId = (typeof CHAR_IDS)[number];

/** A seat is the GM or one of the six characters. */
export type SeatId = "gm" | CharId;
/** Who caused an event. */
export type Actor = SeatId | "system";

export type TrafficColor = "red" | "amber" | "green";

/** Metadata wrapping every event. `seq` is the 1-based append order in the log. */
export interface EventMeta {
  id: string;
  gameId: string;
  seq: number;
  actor: Actor;
  ts: number;
}

/** Discriminated payload map: event type → payload shape. */
export interface EventPayloads {
  GAME_CREATED: { createdAt: number };
  PLAYER_JOINED: { displayName?: string };
  ROLE_CLAIMED: { seat: SeatId; seatTokenHash?: string };
  SEAT_RELEASED: { seat: SeatId };
  SESSION_STARTED: Record<string, never>;
  SESSION_ENDED: Record<string, never>;

  SAFETY_SET: { lines?: string[]; veils?: string[]; calibration?: string[] };
  XCARD_RAISED: { anonymous?: boolean; note?: string };
  XCARD_CLEARED: { changeRequested?: string };
  TRAFFIC_SIGNAL: { color: TrafficColor };

  SCENE_FRAMED: {
    objectives: Objective[];
    threats: Threat[];
    secondaryObjectives?: SecondaryObjective[];
    /** The reference location this board came from — names the scene + surfaces its loot. */
    locationId?: string;
  };
  OBJECTIVE_ADDED: { objective: Objective };
  OBJECTIVE_UPDATED: { id: string; patch: Partial<Objective> };
  OBJECTIVE_COMPLETED: { id: string; narratedBy?: CharId };
  THREAT_ADDED: { threat: Threat };
  THREAT_UPDATED: { id: string; patch: Partial<Threat> };
  THREAT_REMOVED: { id: string };

  TURN_STARTED: { seat: CharId; stat?: Stat; tags?: string[] };
  /** Abort an in-progress turn without it counting as the character's action. */
  TURN_CANCELLED: { seat: CharId };
  POOL_BUILT: { who: "player" | "gm"; dice: number; sources?: PoolSource[] };
  DICE_ROLLED: { who: "player" | "gm"; results: DieFace[] };
  PASSIVE_APPLIED: {
    passiveId: string;
    detail?: string;
    bloodDelta?: number;
    gmSuccessDelta?: number;
  };
  DICE_DISCARDED: { playerSurvivors?: DieFace[]; gmSuccessCount?: number };
  /**
   * Mid-allocation bonus dice (RULES §4 — the pool is NOT frozen at roll time). A newly
   * narrated advantage adds `count` dice now; the server rolls and discards them, and the
   * survivors join the allocation tray. `label` tags their pool source.
   */
  BONUS_DICE_ROLLED: { results: DieFace[]; survivors: DieFace[]; count: number; label?: string };
  DIE_ALLOCATED: {
    kind: AllocationKind;
    targetId?: string;
    units: number;
    specialId?: string;
    detail?: string;
  };
  ALLOCATION_COMMITTED: Record<string, never>;

  /**
   * The injury d6 has been rolled but NOT yet applied (RULES §4 INJURY_CHECK). Parks
   * the rolled face + resolved outcome on the turn so the table sees the reveal and can
   * react (Chuck's hat to shrug it off) before `resolve_injury` marks the box. `outcome`
   * is never `none` here — commit only parks when a GM die got through.
   */
  INJURY_PENDING: { seat: CharId; face: DieFace; outcome: InjuryOutcome };
  INJURY_MARKED: { seat: CharId; category: 0 | 1 | 2; box: 1 | 2; penalty?: string };
  DOWNED: { seat: CharId; category: 0 | 1 | 2; rescueObjectiveId?: string };
  HEALED: { seat: CharId; category: 0 | 1 | 2; box: 1 | 2 };
  DEATH_LAST_STAND: { seat: CharId }; // all 6 boxes marked → opens the Last Stand (RULES §5)
  LAST_STAND_ROLLED: { seat: CharId; dice: DieFace[] }; // the final 8d6
  LAST_STAND_ENDED: { seat: CharId }; // final sacrifice allocated → the vampire retires (dead)
  BLOOD_CHANGED: { seat: CharId; delta: number; reason?: string };
  BLOOD_SHARED: { from: CharId; to: CharId; amount: number };

  EQUIPMENT_USED: { seat: CharId; itemId: string };
  EQUIPMENT_RESTORED: { seat: CharId; itemId: string };
  LOOT_ADDED: { seat: CharId; item: Equipment };
  LOOT_ACTIVATED: { seat: CharId; itemId: string };
  ADVANCE_UNLOCKED: { seat: CharId; advanceId: string };

  SECONDARY_OBJECTIVE_ADDED: { objective: SecondaryObjective };
  SECONDARY_OBJECTIVE_UPDATED: { id: string; patch: Partial<SecondaryObjective> };
  SECONDARY_OBJECTIVE_COMPLETED: { id: string; rewardChoice?: string };
  SECONDARY_OBJECTIVE_REMOVED: { id: string };
  /** Staged loot reveal (issue #15): show/hide one scene "Loot within reach" item (by name) to players. */
  SCENE_LOOT_REVEALED: { name: string; revealed: boolean };

  FLASHBACK_TRIGGERED: { seat: CharId; context: string; question: string };
  ROUND_ENDED: Record<string, never>;
  /** `log` is the per-threat breakdown (incl. each restore's 1d6) for "shown with the dice it rolled" (CLAUDE.md §4). */
  REINFORCEMENTS_APPLIED: { threats: Threat[]; log?: ReinforceLogEntry[]; note?: string };

  /** Explicit, always-logged override (CLAUDE.md §0/§3.2). */
  GM_OVERRIDE: {
    note?: string;
    targetEventId?: string;
    patch?: { objectives?: Objective[]; threats?: Threat[] };
  };
}

export type EventType = keyof EventPayloads;

/** A single event for a given type `T`. */
export type GameEventOf<T extends EventType> = EventMeta & {
  type: T;
  payload: EventPayloads[T];
};

/** Any game event. */
export type GameEvent = { [T in EventType]: GameEventOf<T> }[EventType];

/** Build an event envelope (used by the store/tests). */
export function makeEvent<T extends EventType>(
  meta: EventMeta,
  type: T,
  payload: EventPayloads[T],
): GameEventOf<T> {
  return { ...meta, type, payload };
}
