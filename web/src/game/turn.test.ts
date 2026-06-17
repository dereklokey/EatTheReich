import { describe, it, expect } from "vitest";
import { liveComposingSeat } from "./turn";
import { initialState } from "@shared/state/init.js";
import type { GameState } from "@shared/state/types.js";

const base = (): GameState => initialState("test");

describe("liveComposingSeat", () => {
  it("returns null when nobody is composing", () => {
    expect(liveComposingSeat(base(), null)).toBeNull();
  });

  it("honors a fresh pre-roll pointer", () => {
    expect(liveComposingSeat(base(), "iryna")).toBe("iryna");
  });

  it("drops a pointer for a seat that has already acted this round (the hibernation strand, #50)", () => {
    // The reported bug: the DO hibernated mid-prep, lost the in-memory pointer, and never sent a
    // clear delta — so after that seat's turn completed, clients still showed "X is taking a turn".
    // Once the seat is in actedThisRound, the banner must not trust the stale mirror.
    const s = { ...base(), actedThisRound: ["iryna"] as const } as GameState;
    expect(liveComposingSeat(s, "iryna")).toBeNull();
  });

  it("drops the pointer while a turn is already live", () => {
    const s = base();
    s.currentTurn = { seat: "iryna", phase: "DECLARE", tags: [], allocations: [], challengeConsumed: {} };
    s.activeSeat = "iryna";
    expect(liveComposingSeat(s, "iryna")).toBeNull();
  });

  it("drops the pointer for a dead seat", () => {
    const s = base();
    s.characters.iryna.dead = true;
    expect(liveComposingSeat(s, "iryna")).toBeNull();
  });

  it("a live turn for one seat suppresses a stale pointer for another", () => {
    const s = base();
    s.currentTurn = { seat: "iryna", phase: "DECLARE", tags: [], allocations: [], challengeConsumed: {} };
    s.activeSeat = "iryna";
    expect(liveComposingSeat(s, "chuck")).toBeNull();
  });
});
