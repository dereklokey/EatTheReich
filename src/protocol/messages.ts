import type { Objective, Threat, SecondaryObjective, Stat } from "../domain/types.js";
import type { Allocation } from "../engine/allocate.js";
import type { PoolSource } from "../engine/playerPool.js";
import type { Actor, CharId, GameEvent, SeatId, TrafficColor } from "../events/types.js";
import type { GameState } from "../state/types.js";

/**
 * Wire protocol (CLAUDE.md §3.1). Clients send **intents**; the server validates,
 * rolls dice, computes results, appends events, and broadcasts. Clients never
 * mutate state directly — this is the anti-fudge boundary.
 */

/** A client's request to change the game. The server decides what events result. */
export type Intent =
  | { kind: "create_game" }
  | { kind: "claim_seat"; seat: SeatId; seatTokenHash?: string }
  | { kind: "release_seat"; seat: SeatId }
  | { kind: "start_session" }
  | { kind: "end_session" }
  | { kind: "set_safety"; lines?: string[]; veils?: string[]; calibration?: string[] }
  | { kind: "raise_xcard"; anonymous?: boolean; note?: string }
  | { kind: "clear_xcard"; changeRequested?: string }
  | { kind: "traffic_signal"; color: TrafficColor }
  | { kind: "frame_scene"; objectives: Objective[]; threats: Threat[]; secondaryObjectives?: SecondaryObjective[] }
  | { kind: "add_objective"; objective: Objective }
  | { kind: "update_objective"; id: string; patch: Partial<Objective> }
  | { kind: "complete_objective"; id: string; narratedBy?: CharId }
  | { kind: "add_threat"; threat: Threat }
  | { kind: "update_threat"; id: string; patch: Partial<Threat> }
  | { kind: "remove_threat"; id: string }
  | { kind: "add_secondary_objective"; objective: SecondaryObjective }
  | { kind: "complete_secondary_objective"; id: string; rewardChoice?: string }
  | { kind: "start_turn"; seat: CharId; stat: Stat; engagedThreatIds: string[]; tags?: string[] }
  | { kind: "roll"; playerPoolDice: number; sources?: PoolSource[] }
  | { kind: "resolve_discard" }
  | { kind: "allocate"; allocations: Allocation[] }
  | { kind: "commit" }
  | { kind: "end_round"; reducedToZeroThreatIds?: string[]; zeroSuccessThreatIds?: string[] }
  | { kind: "change_blood"; seat: CharId; delta: number; reason?: string }
  | { kind: "share_blood"; from: CharId; to: CharId; amount: number }
  | { kind: "heal"; seat: CharId; category: 0 | 1 | 2; box: 1 | 2 }
  | { kind: "use_equipment"; seat: CharId; itemId: string }
  | { kind: "unlock_advance"; seat: CharId; advanceId: string }
  | { kind: "trigger_flashback"; seat: CharId; context: string; question: string }
  | { kind: "gm_override"; note?: string; patch?: { objectives?: Objective[]; threats?: Threat[] } };

/** client → server. */
export type ClientMessage =
  | { t: "hello"; seat?: SeatId; seatTokenHash?: string }
  | { t: "heartbeat" }
  | { t: "intent"; intent: Intent; actor?: Actor };

/** server → client. */
export type ServerMessage =
  | { t: "sync"; state: GameState; events: GameEvent[] }
  | { t: "presence"; online: SeatId[] }
  | { t: "error"; message: string };
