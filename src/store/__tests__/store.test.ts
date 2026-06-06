import { describe, it, expect, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { InMemoryStore } from "../memory.js";
import { FileStore } from "../file.js";
import { GameLog, loadState } from "../repository.js";
import type { Store } from "../types.js";
import { reduce } from "../../state/reducer.js";
import { irynaClockTowerEvents } from "../../state/__tests__/scenario.js";

const tmpDirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "etr-store-"));
  tmpDirs.push(d);
  return d;
}
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function appendAll(store: Store, gameId: string) {
  for (const e of irynaClockTowerEvents(gameId)) await store.appendEvent(gameId, e);
}

describe.each([
  ["InMemoryStore", () => Promise.resolve(new InMemoryStore())],
  ["FileStore", async () => new FileStore(await tmp())],
])("%s — Store contract", (_name, make) => {
  it("round-trips the event log and rebuilds the golden state", async () => {
    const store = await make();
    await appendAll(store, "g1");
    expect(await store.lastSeq("g1")).toBe(16);
    const state = await loadState(store, "g1");
    expect(state.board.objectives[0]?.rating).toBe(3);
  });

  it("rejects out-of-order appends", async () => {
    const store = await make();
    const [e1] = irynaClockTowerEvents("g2");
    await store.appendEvent("g2", e1!);
    // skip seq 2, jump to 3
    const wrong = { ...e1!, seq: 3, id: "x" };
    await expect(store.appendEvent("g2", wrong)).rejects.toThrow(/out-of-order/);
  });

  it("snapshot + replay-since equals a full replay", async () => {
    const store = await make();
    const events = irynaClockTowerEvents("g3");
    await appendAll(store, "g3");

    // Take a mid-log snapshot at seq 10, then load (snapshot + tail) and compare
    // to a from-scratch reduce of the entire log.
    const at10 = reduce(events.slice(0, 10));
    await store.saveSnapshot({ gameId: "g3", seq: 10, state: at10 });

    const viaSnapshot = await loadState(store, "g3");
    const viaFullReplay = reduce(events);
    expect(viaSnapshot).toEqual(viaFullReplay);
    expect(viaSnapshot.seq).toBe(16);
  });
});

describe("FileStore durability across a 'restart'", () => {
  it("a fresh FileStore on the same dir rebuilds state from disk (DO-wake analogue)", async () => {
    const dir = await tmp();
    await appendAll(new FileStore(dir), "wake");
    // New instance = lost in-memory state; must rebuild purely from storage.
    const rebooted = await loadState(new FileStore(dir), "wake");
    expect(rebooted.board.objectives[0]?.rating).toBe(3);
    expect(rebooted.actedThisRound).toEqual(["iryna"]);
  });
});

describe("GameLog — seq assignment & periodic snapshots", () => {
  it("assigns sequential seq and snapshots every N events", async () => {
    const store = new InMemoryStore();
    const log = new GameLog(store, { snapshotEvery: 5 });
    const events = irynaClockTowerEvents("g4"); // 16 events

    for (const e of events) {
      // re-drive the same payloads through the append path (it assigns seq itself)
      await log.append("g4", e.actor, e.type, e.payload as never, e.ts);
    }

    expect(await store.lastSeq("g4")).toBe(16);
    const snap = await store.loadSnapshot("g4");
    expect(snap?.seq).toBe(15); // latest of 5,10,15
    const state = await log.load("g4");
    expect(state.board.objectives[0]?.rating).toBe(3);
  });

  it("snapshotNow captures the current head", async () => {
    const store = new InMemoryStore();
    const log = new GameLog(store, { snapshotEvery: 1000 });
    for (const e of irynaClockTowerEvents("g5")) await log.append("g5", e.actor, e.type, e.payload as never, e.ts);
    const snap = await log.snapshotNow("g5");
    expect(snap.seq).toBe(16);
    expect(snap.state.board.objectives[0]?.rating).toBe(3);
  });
});
