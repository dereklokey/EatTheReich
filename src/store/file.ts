import { promises as fs } from "node:fs";
import path from "node:path";
import type { Store, Snapshot } from "./types.js";
import type { GameEvent } from "../events/types.js";

/**
 * File-backed Store: an append-only JSONL log per game plus a JSON snapshot. Used
 * to prove durability/replay offline (CLAUDE.md §5 step 3). It mirrors the DO
 * storage key scheme conceptually (`evt:<gameId>:<seq>`, `snapshot:<gameId>`).
 */
export class FileStore implements Store {
  constructor(private dir: string) {}

  private eventsPath(gameId: string): string {
    return path.join(this.dir, `${encodeURIComponent(gameId)}.events.jsonl`);
  }
  private snapshotPath(gameId: string): string {
    return path.join(this.dir, `${encodeURIComponent(gameId)}.snapshot.json`);
  }

  async appendEvent(gameId: string, e: GameEvent): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const expected = (await this.lastSeq(gameId)) + 1;
    if (e.seq !== expected) {
      throw new Error(`out-of-order append for ${gameId}: got seq ${e.seq}, expected ${expected}`);
    }
    await fs.appendFile(this.eventsPath(gameId), JSON.stringify(e) + "\n", "utf8");
  }

  async loadEvents(gameId: string, sinceSeq = 0): Promise<GameEvent[]> {
    const text = await this.readOrEmpty(this.eventsPath(gameId));
    if (!text) return [];
    return text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as GameEvent)
      .filter((e) => e.seq > sinceSeq);
  }

  async saveSnapshot(snap: Snapshot): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    // Atomic-ish write: temp file then rename.
    const finalPath = this.snapshotPath(snap.gameId);
    const tmpPath = `${finalPath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(snap), "utf8");
    await fs.rename(tmpPath, finalPath);
  }

  async loadSnapshot(gameId: string): Promise<Snapshot | null> {
    const text = await this.readOrEmpty(this.snapshotPath(gameId));
    return text ? (JSON.parse(text) as Snapshot) : null;
  }

  async lastSeq(gameId: string): Promise<number> {
    const events = await this.loadEvents(gameId);
    return events.length > 0 ? events[events.length - 1]!.seq : 0;
  }

  private async readOrEmpty(p: string): Promise<string> {
    try {
      return await fs.readFile(p, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw err;
    }
  }
}
