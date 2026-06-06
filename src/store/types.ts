import type { GameEvent } from "../events/types.js";
import type { GameState } from "../state/types.js";

/**
 * Persistence behind an interface (CLAUDE.md §3.3) so the backing store can be
 * swapped (in-memory/file for offline proving → Durable Object SQLite storage in
 * §3.4) without touching the engine or reducer.
 *
 * Authority model: clients never write here directly. Flow is
 * `intent → server validate+roll+reduce → append event → broadcast` (§3.1).
 */
export interface Snapshot {
  gameId: string;
  /** seq of the last event folded into `state`. */
  seq: number;
  state: GameState;
}

export interface Store {
  /** Append an event. Events must arrive in monotonically increasing `seq`. */
  appendEvent(gameId: string, e: GameEvent): Promise<void>;
  /** Events with seq > `sinceSeq` (default 0 = all), in order. */
  loadEvents(gameId: string, sinceSeq?: number): Promise<GameEvent[]>;
  /** Persist a periodic snapshot so long games don't replay thousands of events. */
  saveSnapshot(snap: Snapshot): Promise<void>;
  /** Latest snapshot, or null if none. */
  loadSnapshot(gameId: string): Promise<Snapshot | null>;
  /** Highest event seq for a game (0 if none) — used to assign the next seq. */
  lastSeq(gameId: string): Promise<number>;
}
