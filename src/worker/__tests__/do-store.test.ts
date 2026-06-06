import { describe, it, expect } from "vitest";
import { DOStore } from "../do-store.js";
import type { DOStorage } from "../do-store.js";
import { loadState } from "../../store/repository.js";
import { reduce } from "../../state/reducer.js";
import { irynaClockTowerEvents } from "../../state/__tests__/scenario.js";

/**
 * Map-backed fake of the Durable Object storage API — same ordering semantics
 * (`list()` returns keys ascending, honouring prefix/start/end) so DOStore can be
 * proven offline without the workers runtime.
 */
class FakeDOStorage implements DOStorage {
  private m = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.m.get(key) as T | undefined;
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.m.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.m.delete(key);
  }
  async list<T>(opts?: { prefix?: string; start?: string; end?: string; limit?: number }): Promise<Map<string, T>> {
    const { prefix, start, end, limit } = opts ?? {};
    const keys = [...this.m.keys()]
      .filter((k) => (!prefix || k.startsWith(prefix)) && (!start || k >= start) && (!end || k < end))
      .sort();
    const out = new Map<string, T>();
    for (const k of keys) {
      if (limit !== undefined && out.size >= limit) break;
      out.set(k, this.m.get(k) as T);
    }
    return out;
  }
}

describe("DOStore — Store against DO storage (key scheme evt:/snapshot/meta)", () => {
  it("appends, reports lastSeq, and loads events in seq order", async () => {
    const store = new DOStore(new FakeDOStorage());
    const events = irynaClockTowerEvents("room");
    for (const e of events) await store.appendEvent("room", e);

    expect(await store.lastSeq("room")).toBe(16);
    const loaded = await store.loadEvents("room");
    expect(loaded.map((e) => e.seq)).toEqual(events.map((e) => e.seq)); // ascending
    expect(await store.loadEvents("room", 13)).toHaveLength(3); // 14,15,16
  });

  it("round-trips through loadState to the golden end state (DO-wake path)", async () => {
    const store = new DOStore(new FakeDOStorage());
    for (const e of irynaClockTowerEvents("room")) await store.appendEvent("room", e);
    const state = await loadState(store, "room");
    expect(state.board.objectives[0]?.rating).toBe(3);
  });

  it("rejects out-of-order appends (monotonic seq)", async () => {
    const store = new DOStore(new FakeDOStorage());
    const [e1, , e3] = irynaClockTowerEvents("room");
    await store.appendEvent("room", e1!);
    await expect(store.appendEvent("room", e3!)).rejects.toThrow(/out-of-order/);
  });

  it("snapshot + replay-since equals a full replay", async () => {
    const fake = new FakeDOStorage();
    const store = new DOStore(fake);
    const events = irynaClockTowerEvents("room");
    for (const e of events) await store.appendEvent("room", e);

    await store.saveSnapshot({ gameId: "room", seq: 10, state: reduce(events.slice(0, 10)) });
    const viaSnapshot = await loadState(store, "room");
    expect(viaSnapshot).toEqual(reduce(events));

    const snap = await store.loadSnapshot("room");
    expect(snap?.seq).toBe(10);
  });
});
