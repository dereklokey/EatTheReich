import type { Store, Snapshot } from "../store/types.js";
import type { GameEvent } from "../events/types.js";

/**
 * The subset of the Durable Object storage API we use (CLAUDE.md §3.4). Declaring
 * it locally keeps DOStore testable with a Map-backed fake and free of a hard
 * dependency on @cloudflare/workers-types. The real `DurableObjectStorage` satisfies
 * this structurally.
 */
export interface DOStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  list<T = unknown>(options?: {
    prefix?: string;
    start?: string;
    end?: string;
    limit?: number;
  }): Promise<Map<string, T>>;
  delete(key: string): Promise<boolean>;
}

const SEQ_PAD = 12;
const EVT_PREFIX = "evt:";
const SNAPSHOT_KEY = "snapshot";
const LAST_SEQ_KEY = "meta:lastSeq";

const evtKey = (seq: number): string => EVT_PREFIX + String(seq).padStart(SEQ_PAD, "0");

/**
 * `Store` backed by a Durable Object's own SQLite-backed storage. Keys:
 *   evt:<zero-padded-seq>  (append-only log; list() returns them sorted)
 *   snapshot               (latest snapshot)
 *   meta:lastSeq           (O(1) head pointer)
 *
 * One DO == one game, so `gameId` is implicit and the parameter is ignored. State
 * lives only in storage between bursts of play — exactly what hibernation requires.
 */
export class DOStore implements Store {
  constructor(private storage: DOStorage) {}

  async appendEvent(_gameId: string, e: GameEvent): Promise<void> {
    const expected = (await this.lastSeq(_gameId)) + 1;
    if (e.seq !== expected) {
      throw new Error(`out-of-order append: got seq ${e.seq}, expected ${expected}`);
    }
    await this.storage.put(evtKey(e.seq), e);
    await this.storage.put(LAST_SEQ_KEY, e.seq);
  }

  async loadEvents(_gameId: string, sinceSeq = 0): Promise<GameEvent[]> {
    const map = await this.storage.list<GameEvent>({
      prefix: EVT_PREFIX,
      start: evtKey(sinceSeq + 1),
    });
    // list() returns keys in sorted (ascending) order → already in seq order.
    return [...map.values()];
  }

  async saveSnapshot(snap: Snapshot): Promise<void> {
    await this.storage.put(SNAPSHOT_KEY, snap);
  }

  async loadSnapshot(_gameId: string): Promise<Snapshot | null> {
    return (await this.storage.get<Snapshot>(SNAPSHOT_KEY)) ?? null;
  }

  async lastSeq(_gameId: string): Promise<number> {
    return (await this.storage.get<number>(LAST_SEQ_KEY)) ?? 0;
  }

  async rewindTo(_gameId: string, toSeq: number): Promise<void> {
    // Delete every event past the rewind point.
    const doomed = await this.storage.list<GameEvent>({ prefix: EVT_PREFIX, start: evtKey(toSeq + 1) });
    for (const key of doomed.keys()) await this.storage.delete(key);
    await this.storage.put(LAST_SEQ_KEY, toSeq);
    // Drop a snapshot that's now newer than the head so rebuild replays cleanly.
    const snap = await this.storage.get<Snapshot>(SNAPSHOT_KEY);
    if (snap && snap.seq > toSeq) await this.storage.delete(SNAPSHOT_KEY);
  }
}
