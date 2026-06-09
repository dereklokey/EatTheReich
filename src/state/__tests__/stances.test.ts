import { describe, it, expect } from "vitest";
import { activeMantle, effectiveStats, itemsBlockedByMantle } from "../stances.js";
import { initCharacterRuntime } from "../init.js";
import type { CharacterRuntime, ActiveStance } from "../types.js";
import type { Objective } from "../../domain/types.js";
import { CHARACTERS_BY_ID } from "../../data/characters.js";

const mantle = (objectiveId: string): ActiveStance => ({
  kind: "mantle",
  powerId: "iryna-mantle",
  powerName: "Mantle of the Fell Beast",
  highStats: ["BRAWL", "TERRIFY"],
  highValue: 4,
  lowValue: 1,
  blocksItems: true,
  objectiveId,
  objectiveName: "Take cover",
});

const withStances = (stances: ActiveStance[]): CharacterRuntime => ({ ...initCharacterRuntime("iryna"), stances });
const obj = (id: string, rating: number): Objective => ({ id, name: "Take cover", kind: "objective", rating });

describe("cross-turn stance selectors (#36)", () => {
  it("activeMantle returns the stance only while its bound Objective is in play (rating > 0)", () => {
    const char = withStances([mantle("o1")]);
    expect(activeMantle(char, [obj("o1", 5)])?.objectiveId).toBe("o1");
    // Objective completed (rating 0) → derived inactive, no clear event needed.
    expect(activeMantle(char, [obj("o1", 0)])).toBeUndefined();
    // Objective gone (a fresh scene) → inactive too.
    expect(activeMantle(char, [obj("other", 5)])).toBeUndefined();
  });

  it("activeMantle ignores characters with no Mantle stance", () => {
    expect(activeMantle(withStances([]), [obj("o1", 5)])).toBeUndefined();
    expect(activeMantle(undefined, [obj("o1", 5)])).toBeUndefined();
    const ignore: ActiveStance = { kind: "ignore-threat-challenge", powerId: "iryna-hells-fire", powerName: "Hell's Ravenous Fire" };
    expect(activeMantle(withStances([ignore]), [obj("o1", 5)])).toBeUndefined();
  });

  it("effectiveStats forces highStats to highValue and collapses the rest to lowValue", () => {
    const base = CHARACTERS_BY_ID.iryna!.stats;
    const transformed = effectiveStats(base, mantle("o1"));
    expect(transformed.BRAWL).toBe(4);
    expect(transformed.TERRIFY).toBe(4);
    for (const s of ["CON", "FIX", "SEARCH", "SHOOT", "SNEAK"] as const) expect(transformed[s]).toBe(1);
  });

  it("effectiveStats returns the base unchanged when no Mantle is active", () => {
    const base = CHARACTERS_BY_ID.iryna!.stats;
    expect(effectiveStats(base, undefined)).toEqual(base);
  });

  it("itemsBlockedByMantle is true only while an active Mantle holds blocksItems", () => {
    expect(itemsBlockedByMantle(withStances([mantle("o1")]), [obj("o1", 5)])).toBe(true);
    expect(itemsBlockedByMantle(withStances([mantle("o1")]), [obj("o1", 0)])).toBe(false); // Objective done
    expect(itemsBlockedByMantle(withStances([]), [obj("o1", 5)])).toBe(false);
  });
});
