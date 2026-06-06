import type { Store, Snapshot } from "./types.js";
import type { GameState } from "../state/types.js";
import type { Actor, EventType, EventPayloads, GameEvent, GameEventOf } from "../events/types.js";
import { makeEvent } from "../events/types.js";
import { reduce } from "../state/reducer.js";
import { initialState } from "../state/init.js";

export const DEFAULT_SNAPSHOT_EVERY = 50;

/**
 * Rebuild current state by replaying from the latest snapshot (CLAUDE.md §3.1/§3.4
 * — exactly what a Durable Object does on wake: load snapshot + replay events
 * since). With no snapshot, replays the whole log from the initial state.
 */
export async function loadState(store: Store, gameId: string): Promise<GameState> {
  const snap = await store.loadSnapshot(gameId);
  const base = snap?.state ?? initialState(gameId);
  const events = await store.loadEvents(gameId, snap?.seq ?? 0);
  return reduce(events, base);
}

/**
 * Append-side orchestration: assigns the next `seq`, persists the event, and writes
 * a fresh snapshot every N events so replays stay cheap. The server (later, the DO)
 * owns an instance of this; clients never touch the store directly.
 */
export class GameLog {
  private snapshotEvery: number;

  constructor(private store: Store, opts: { snapshotEvery?: number } = {}) {
    this.snapshotEvery = opts.snapshotEvery ?? DEFAULT_SNAPSHOT_EVERY;
  }

  /** Append a typed event. `ts` is injected by the caller (no clock in lib code). */
  async append<T extends EventType>(
    gameId: string,
    actor: Actor,
    type: T,
    payload: EventPayloads[T],
    ts: number,
  ): Promise<GameEventOf<T>> {
    const seq = (await this.store.lastSeq(gameId)) + 1;
    const event = makeEvent({ id: `evt_${gameId}_${seq}`, gameId, seq, actor, ts }, type, payload);
    // GameEventOf<T> is a union member, but TS can't prove it for a generic T.
    await this.store.appendEvent(gameId, event as GameEvent);
    if (seq % this.snapshotEvery === 0) {
      const state = await loadState(this.store, gameId);
      await this.store.saveSnapshot({ gameId, seq, state });
    }
    return event;
  }

  load(gameId: string): Promise<GameState> {
    return loadState(this.store, gameId);
  }

  /** GM rewind: drop events past `toSeq`, then return the rebuilt state (§3.2). */
  async rewindTo(gameId: string, toSeq: number): Promise<GameState> {
    await this.store.rewindTo(gameId, toSeq);
    return loadState(this.store, gameId);
  }

  /** Force a snapshot at the current head (e.g. on graceful shutdown). */
  async snapshotNow(gameId: string): Promise<Snapshot> {
    const seq = await this.store.lastSeq(gameId);
    const state = await loadState(this.store, gameId);
    const snap: Snapshot = { gameId, seq, state };
    await this.store.saveSnapshot(snap);
    return snap;
  }
}
