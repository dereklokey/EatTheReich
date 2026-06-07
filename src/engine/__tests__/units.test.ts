import { describe, it, expect } from "vitest";
import { sequenceRoller } from "../../domain/dice.js";
import {
  buildPlayerPool,
  buildGmPool,
  gmPoolContributions,
  resolvePlayerDice,
  gmSuccesses,
  reduceGmSuccessesPerOne,
  corpseEaterBlood,
  countOnes,
  applyAllocations,
  clampBlood,
  type BoardState,
} from "../index.js";
import { markInjury, emptyInjuryTrack, defaultCategoryFromD6 } from "../injury.js";
import { naziSquad, infantrySquad, policePatrol } from "../../data/threats.js";

describe("buildPlayerPool", () => {
  it("sums stat + equipment + satisfied bonus + abilities", () => {
    const r = buildPlayerPool({
      stat: { name: "BRAWL", rating: 2 },
      equipment: [{ label: "axe", bonusPlus: 2, bonusSatisfied: true }],
      abilities: [{ label: "Frenzy" }, { label: "Stare", addsDie: false }],
    });
    // 2 (stat) + 1 (axe) + 2 (axe bonus) + 1 (Frenzy) + 0 (Stare adds no die) = 6
    expect(r.total).toBe(6);
    expect(r.sources.map((s) => s.label)).toEqual([
      "BRAWL",
      "axe",
      "+axe bonus",
      "Frenzy",
    ]);
  });

  it("adds an ability's satisfied bonus dice (RULES §4 — gear/abilities both carry +tag bonuses)", () => {
    const r = buildPlayerPool({
      stat: { name: "TERRIFY", rating: 3 },
      abilities: [
        { label: "Dark Glamour", bonusPlus: 1, bonusSatisfied: true },
        { label: "Night's Servants", bonusPlus: 1, bonusSatisfied: false },
      ],
    });
    // 3 (stat) + 1 (Dark Glamour) + 1 (its bonus) + 1 (Night's Servants, bonus unclaimed) = 6
    expect(r.total).toBe(6);
    expect(r.sources.map((s) => s.label)).toEqual([
      "TERRIFY",
      "Dark Glamour",
      "+Dark Glamour bonus",
      "Night's Servants",
    ]);
  });

  it("adds Go Out With A Bang on the last use of an item", () => {
    const r = buildPlayerPool({
      stat: { name: "SHOOT", rating: 1 },
      equipment: [{ label: "panzerfaust", usesBefore: 1 }],
    });
    // 1 (stat) + 1 (use) + 1 (Go Out With A Bang) = 3
    expect(r.total).toBe(3);
  });
});

describe("buildGmPool — derived from the Threats in play", () => {
  it("returns its Attack for a single Threat in play", () => {
    expect(buildGmPool([naziSquad()])).toBe(3); // attack 3, no others
  });

  it("returns 0 when no Threat is in play (all defeated → uncontested)", () => {
    const dead = { ...naziSquad(), rating: 0, attack: 0 };
    expect(buildGmPool([])).toBe(0);
    expect(buildGmPool([dead])).toBe(0);
  });

  it("adds +1 per additional Threat in play (no player selection)", () => {
    const squad = infantrySquad(); // attack 3
    const police = policePatrol(); // attack 2
    expect(buildGmPool([squad, police])).toBe(4); // 3 + 1
  });
});

describe("gmPoolContributions — per-Threat breakdown", () => {
  it("anchors on the highest Attack, adds 1 for each other Threat, and sums to the pool", () => {
    const squad = infantrySquad(); // attack 3
    const police = policePatrol(); // attack 2
    const byName = Object.fromEntries(
      gmPoolContributions([police, squad]).map((c) => [c.threat.name, c]), // order shouldn't matter
    );
    expect(byName["Infantry Squad"]).toMatchObject({ dice: 3, anchor: true });
    expect(byName["Police Patrol"]).toMatchObject({ dice: 1, anchor: false });
    const total = Object.values(byName).reduce((n, c) => n + c.dice, 0);
    expect(total).toBe(buildGmPool([squad, police]));
  });

  it("ignores defeated Threats", () => {
    const dead = { ...infantrySquad(), rating: 0, attack: 0 };
    expect(gmPoolContributions([dead, policePatrol()])).toEqual([
      expect.objectContaining({ dice: 2, anchor: true }), // only the live Police Patrol
    ]);
  });
});

describe("staged threats are out of play (issue #12)", () => {
  it("a staged Threat contributes no Reich dice (pool nor breakdown)", () => {
    const staged = { ...infantrySquad(), active: false as const }; // attack 3, but held back
    const police = policePatrol(); // attack 2, in play
    // Only the Police Patrol is in play → its Attack, no +1 for the staged squad.
    expect(buildGmPool([staged, police])).toBe(2);
    expect(gmPoolContributions([staged, police])).toEqual([
      expect.objectContaining({ threat: expect.objectContaining({ name: "Police Patrol" }), dice: 2, anchor: true }),
    ]);
  });

  it("a board of only staged Threats is uncontested", () => {
    expect(buildGmPool([{ ...infantrySquad(), active: false as const }])).toBe(0);
  });

  it("an explicitly active Threat (and a field-less legacy one) are in play", () => {
    expect(buildGmPool([{ ...infantrySquad(), active: true }])).toBe(3);
    expect(buildGmPool([infantrySquad()])).toBe(3); // no `active` field → in play
  });
});

describe("discard & gm successes", () => {
  it("Rust-Witch raised threshold ≤4 leaves only 5,6 (6 still crit)", () => {
    const { survivors, discarded } = resolvePlayerDice([6, 5, 4, 3], 4);
    expect(survivors.map((d) => [d.face, d.kind])).toEqual([
      [6, "crit"],
      [5, "success"],
    ]);
    expect(discarded).toEqual([4, 3]);
  });

  it("GM dice have no crit: a 6 is one success", () => {
    expect(gmSuccesses([6, 6, 4, 3]).length).toBe(3);
  });
});

describe("pre-discard passives (RULES §5 ordering)", () => {
  it("Dead Man's Luck / Bone Armour: −1 GM success per player 1", () => {
    const playerOnes = countOnes([1, 1, 5, 6]);
    expect(playerOnes).toBe(2);
    expect(reduceGmSuccessesPerOne(3, playerOnes)).toBe(1);
    expect(reduceGmSuccessesPerOne(1, playerOnes)).toBe(0); // floored at 0
  });

  it("Corpse Eater: +1 Blood if any 1 rolled, else 0", () => {
    expect(corpseEaterBlood([2, 3, 1])).toBe(1);
    expect(corpseEaterBlood([2, 3, 4])).toBe(0);
  });
});

describe("allocation: feed, defend, eliminate", () => {
  it("Feed accumulates blood and clampBlood caps at 10", () => {
    const board: BoardState = { objectives: [], threats: [] };
    const r = applyAllocations(board, [{ kind: "feed", units: 2 }], 0);
    expect(r.bloodGained).toBe(2);
    expect(clampBlood(9 + r.bloodGained)).toBe(10);
  });

  it("Defend removes GM dice but never below 0", () => {
    const board: BoardState = { objectives: [], threats: [] };
    const r = applyAllocations(board, [{ kind: "defend", units: 5 }], 2);
    expect(r.gmDiceRemaining).toBe(0);
  });

  it("Eliminating a threat to 0 forces Attack to 0", () => {
    const squad = infantrySquad();
    const board: BoardState = { objectives: [], threats: [squad] };
    const r = applyAllocations(
      board,
      [{ kind: "eliminate", targetId: squad.id, units: 6 }],
      0,
    );
    expect(r.board.threats[0]!.rating).toBe(0);
    expect(r.board.threats[0]!.attack).toBe(0);
  });
});

describe("injury track cascade (RULES §5)", () => {
  it("ticks first box, then second (penalty), then spills to an alternate", () => {
    let track = emptyInjuryTrack();
    let r = markInjury(track, 0);
    expect(r.box).toBe(1);
    track = r.track;
    r = markInjury(track, 0);
    expect(r.box).toBe(2); // second box → penalty trigger condition
    track = r.track;
    r = markInjury(track, 0); // category 0 full → spills to category 1
    expect(r.category).toBe(1);
    expect(r.box).toBe(1);
  });

  it("default d6 → category mapping splits 1-2 / 3-4 / 5-6", () => {
    expect(defaultCategoryFromD6(1)).toBe(0);
    expect(defaultCategoryFromD6(2)).toBe(0);
    expect(defaultCategoryFromD6(3)).toBe(1);
    expect(defaultCategoryFromD6(5)).toBe(2);
  });

  it("filling all six boxes is not death; a further mark overflows to death", () => {
    let track = emptyInjuryTrack();
    for (let i = 0; i < 6; i++) {
      const r = markInjury(track, (i % 3) as 0 | 1 | 2);
      track = r.track;
      expect(r.overflowToDeath).toBe(false); // each of the 6 finds a free box
    }
    expect(track).toEqual([2, 2, 2]); // all boxes marked
    const overflow = markInjury(track, 0); // no box free anywhere
    expect(overflow.overflowToDeath).toBe(true);
  });
});

describe("dice rollers", () => {
  it("sequenceRoller hands back fixed faces in order, then throws", () => {
    const roller = sequenceRoller([6, 1, 4]);
    expect(roller.roll(2)).toEqual([6, 1]);
    expect(roller.roll(1)).toEqual([4]);
    expect(() => roller.roll(1)).toThrow(/exhausted/);
  });
});
