import { describe, it, expect } from "vitest";
import { reduce } from "../reducer.js";
import { irynaClockTowerEvents } from "./scenario.js";

/**
 * Integration: the RULES §12-A golden turn, driven entirely through the event log,
 * must reduce to the same end state the pure engine produced — proving the event
 * layer and the engine agree.
 */
describe("Iryna clock-tower turn, replayed from events", () => {
  const state = reduce(irynaClockTowerEvents("g-iryna"));

  it("reduces the Objective from 6 to 3", () => {
    expect(state.board.objectives[0]?.rating).toBe(3);
  });

  it("leaves the threat's rating and Attack untouched (Defend doesn't lower Attack)", () => {
    expect(state.board.threats[0]?.rating).toBe(4);
    expect(state.board.threats[0]?.attack).toBe(3);
  });

  it("takes no Injury (all GM dice defended) and gains no Blood", () => {
    expect(state.characters.iryna.injuries).toEqual([0, 0, 0]);
    expect(state.characters.iryna.blood).toBe(0);
    expect(state.characters.iryna.downed).toBe(false);
  });

  it("spends a use of the Explosive Runes (2 → 1)", () => {
    expect(state.characters.iryna.equipmentUses["iryna-runes"]).toBe(1);
  });

  it("ends the turn: Iryna has acted, no turn in progress, session is live", () => {
    expect(state.actedThisRound).toEqual(["iryna"]);
    expect(state.currentTurn).toBeNull();
    expect(state.activeSeat).toBeNull();
    expect(state.session).toEqual({ number: 1, active: true });
  });
});
