import type { Objective, Threat, SecondaryObjective, Stat } from "../domain/types.js";
import type { Equipment } from "../domain/character.js";
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
  | { kind: "claim_seat"; seat: SeatId }
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
  | { kind: "loot_add"; seat: CharId; item: Equipment }
  | { kind: "loot_activate"; seat: CharId; itemId: string }
  | { kind: "unlock_advance"; seat: CharId; advanceId: string }
  | { kind: "trigger_flashback"; seat: CharId; context: string; question: string }
  | { kind: "gm_override"; note?: string; patch?: { objectives?: Objective[]; threats?: Threat[] } };

/**
 * client → server.
 *
 * `hello` is the reclaim handshake (§3.6/§3A): a returning client presents its seat
 * plus the **raw** seatToken it stored in localStorage. The server hashes it and, on
 * a match, auto-seats that connection. `actor` on an intent is advisory only — the
 * server authorizes against the connection's authenticated seat, never this field.
 */
export type ClientMessage =
  | { t: "hello"; seat?: SeatId; seatToken?: string }
  | { t: "heartbeat" }
  | { t: "intent"; intent: Intent; actor?: Actor };

/**
 * server → client.
 *
 * `seat_granted` hands the freshly-minted raw seatToken to the claiming client (and
 * only that client) so it can persist it for next week's reclaim; the log keeps only
 * the hash. `presence` is transient online-status, never reduced from events (§3A).
 */
export type ServerMessage =
  | { t: "sync"; state: GameState; events: GameEvent[] }
  | { t: "seat_granted"; seat: SeatId; seatToken: string }
  | { t: "presence"; online: SeatId[] }
  | { t: "error"; message: string };
