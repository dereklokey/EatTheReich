import type { Store, Snapshot } from "./types.js";
import type { GameEvent } from "../events/types.js";

/**
 * In-memory Store — the offline/test backing (CLAUDE.md §5 step 3). Also a faithful
 * stand-in for the Durable Object's in-RAM behaviour: state is discarded on
 * "hibernation" (a fresh instance), so correctness must come from replaying the log.
 */
export class InMemoryStore implements Store {
  private events = new Map<string, GameEvent[]>();
  private snapshots = new Map<string, Snapshot>();

  async appendEvent(gameId: string, e: GameEvent): Promise<void> {
    const log = this.events.get(gameId) ?? [];
    const expected = (log[log.length - 1]?.seq ?? 0) + 1;
    if (e.seq !== expected) {
      throw new Error(`out-of-order append for ${gameId}: got seq ${e.seq}, expected ${expected}`);
    }
    log.push(e);
    this.events.set(gameId, log);
  }

  async loadEvents(gameId: string, sinceSeq = 0): Promise<GameEvent[]> {
    return (this.events.get(gameId) ?? []).filter((e) => e.seq > sinceSeq);
  }

  async saveSnapshot(snap: Snapshot): Promise<void> {
    const existing = this.snapshots.get(snap.gameId);
    if (!existing || snap.seq >= existing.seq) this.snapshots.set(snap.gameId, snap);
  }

  async loadSnapshot(gameId: string): Promise<Snapshot | null> {
    return this.snapshots.get(gameId) ?? null;
  }

  async lastSeq(gameId: string): Promise<number> {
    const log = this.events.get(gameId);
    return log && log.length > 0 ? log[log.length - 1]!.seq : 0;
  }
}
