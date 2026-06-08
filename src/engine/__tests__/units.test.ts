import { describe, it, expect } from "vitest";
import { sequenceRoller } from "../../domain/dice.js";
import {
  buildPlayerPool,
  buildGmPool,
  gmPoolContributions,
  whiffAnchor,
  resolvePlayerDice,
  gmSuccesses,
  gmSuccessTally,
  countSixes,
  reduceGmSuccessesPerOne,
  corpseEaterBlood,
  countOnes,
  applyAllocations,
  applyOneAllocation,
  emptyAccumulator,
  clampBlood,
  reinforce,
  boardGrantedSpecials,
  type BoardState,
} from "../index.js";
import { markInjury, emptyInjuryTrack, defaultCategoryFromD6, rendInjury, resolveInjury } from "../injury.js";
import { naziSquad, infantrySquad, policePatrol, einherjar, paratrooperSquad, motorcycleSquad, werhund } from "../../data/threats.js";
import { feedBlockedByBloodless, rendingClawsInPlay } from "../../domain/types.js";

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

describe("feedBlockedByBloodless — Einherjar 'Bloodless' (rulebook p55, issue #20)", () => {
  it("blocks Feed when the Einherjar is the sole Threat in play", () => {
    expect(feedBlockedByBloodless([einherjar()])).toBe(true);
  });

  it("still blocks with two Einherjar in play (engaged only with the Einherjar)", () => {
    expect(feedBlockedByBloodless([einherjar(), einherjar()])).toBe(true);
  });

  it("allows Feed once any non-bloodless Threat is also in play", () => {
    expect(feedBlockedByBloodless([einherjar(), naziSquad()])).toBe(false);
  });

  it("does not block when no Threat is in play (uncontested → nothing to be engaged with)", () => {
    expect(feedBlockedByBloodless([])).toBe(false);
    expect(feedBlockedByBloodless([{ ...einherjar(), rating: 0, attack: 0 }])).toBe(false);
  });

  it("does not block while the Einherjar is merely staged (out of play, issue #12)", () => {
    expect(feedBlockedByBloodless([{ ...einherjar(), active: false }])).toBe(false);
  });

  it("does not block for ordinary Threats", () => {
    expect(feedBlockedByBloodless([naziSquad(), policePatrol()])).toBe(false);
  });
});

describe("whiffAnchor — GM zero-success escalation (RULES §8, rulebook p38)", () => {
  const squad = infantrySquad(); // attack 3
  const police = policePatrol(); // attack 2

  it("returns the anchor (highest-Attack) Threat when the Reich rolled zero successes", () => {
    // No die ≥ 4 → a whiff → the lead Threat presses harder.
    expect(whiffAnchor([police, squad], [1, 3, 2, 3])?.name).toBe("Infantry Squad");
  });

  it("is null when the Reich rolled any success", () => {
    expect(whiffAnchor([police, squad], [1, 3, 4])).toBeNull(); // a 4 is a success
    expect(whiffAnchor([police, squad], [6])).toBeNull(); // a crit
  });

  it("is null on an uncontested action (the Reich never rolled)", () => {
    expect(whiffAnchor([police, squad], [])).toBeNull();
  });

  it("is null when no Threat is left in play to escalate", () => {
    const dead = { ...squad, rating: 0, attack: 0 };
    expect(whiffAnchor([dead], [1, 2, 3])).toBeNull();
  });

  it("skips a defeated anchor and escalates the next live Threat", () => {
    const dead = { ...squad, rating: 0, attack: 0 }; // the would-be anchor, now dead
    expect(whiffAnchor([dead, police], [2, 1])?.name).toBe("Police Patrol");
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

describe("reinforce — Paratrooper 'Rapid Deployment' (rulebook p61, issue #22)", () => {
  it("a +1 Attack escalation (rule 2) also adds +2 rating, logged as ratingDelta", () => {
    const para = paratrooperSquad(); // rating 6, attack 3, reinforces
    const { threats, log } = reinforce({ threats: [para], reducedToZeroThisRound: new Set(), roller: sequenceRoller([]) });
    expect(threats[0]).toMatchObject({ attack: 4, rating: 8 }); // ATK 3→4, rating 6→8
    expect(log[0]).toMatchObject({ attackBefore: 3, attackAfter: 4, ratingDelta: 2 });
  });

  it("does NOT add +2 when defeated this round — that path resets Attack, not adds (no ratingDelta)", () => {
    const para = { ...paratrooperSquad(), rating: 0, attack: 0 };
    const { threats, log } = reinforce({ threats: [para], reducedToZeroThisRound: new Set([para.id]), roller: sequenceRoller([5]) });
    expect(threats[0]).toMatchObject({ rating: 5, attack: 1 }); // 0 + 1d6(5); floor(3/2)=1 — no extra +2
    expect(log[0]?.ratingDelta).toBeUndefined();
  });

  it("an ordinary Threat's +1 escalation leaves rating untouched (no ratingDelta)", () => {
    const squad = infantrySquad(); // rating 6, attack 3, no rapid rule
    const { threats, log } = reinforce({ threats: [squad], reducedToZeroThisRound: new Set(), roller: sequenceRoller([]) });
    expect(threats[0]).toMatchObject({ attack: 4, rating: 6 }); // ATK +1, rating unchanged
    expect(log[0]?.ratingDelta).toBeUndefined();
  });
});

describe("gmSuccessTally — Vampirjäger 'Anathema' (rulebook p64, issue #21)", () => {
  it("without Anathema equals the plain success count", () => {
    expect(gmSuccessTally([6, 6, 4, 3])).toBe(3); // same as gmSuccesses().length
    expect(countSixes([6, 6, 4, 3])).toBe(2);
  });

  it("scores 2 successes per 6 when Anathema is in play (+1 per 6)", () => {
    expect(gmSuccessTally([6, 6, 4, 3], true)).toBe(5); // 3 base + 2 sixes
  });

  it("adds nothing when there are no 6s, Anathema or not", () => {
    expect(gmSuccessTally([5, 4, 4, 2], true)).toBe(3);
    expect(gmSuccessTally([5, 4, 4, 2], false)).toBe(3);
  });

  it("a whiff stays a whiff — no 6s, no successes, no bonus", () => {
    expect(gmSuccessTally([1, 2, 3], true)).toBe(0);
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

describe("board-granted SPECIAL: Motorcycle 'Crash & Burn' (rulebook p61, issue #23)", () => {
  it("boardGrantedSpecials offers a Crash & Burn special per in-play Motorcycle Squad", () => {
    const moto = motorcycleSquad();
    const specials = boardGrantedSpecials([moto]);
    expect(specials).toHaveLength(1);
    expect(specials[0]).toMatchObject({ id: `crash-and-burn:${moto.id}`, threatId: moto.id, damage: 3 });
  });

  it("offers nothing for staged, defeated, or ordinary Threats", () => {
    expect(boardGrantedSpecials([{ ...motorcycleSquad(), active: false }])).toHaveLength(0); // staged (#12)
    expect(boardGrantedSpecials([{ ...motorcycleSquad(), rating: 0 }])).toHaveLength(0); // defeated
    expect(boardGrantedSpecials([infantrySquad()])).toHaveLength(0); // no crash-and-burn rule
  });

  it("spending a crit on it inflicts the carried flat damage on the target Threat", () => {
    const moto = motorcycleSquad(); // rating 10
    const board: BoardState = { objectives: [], threats: [moto] };
    const acc = applyOneAllocation(emptyAccumulator(board, 0), { kind: "special", specialId: `crash-and-burn:${moto.id}`, targetId: moto.id, units: 3 });
    expect(acc.board.threats[0]!.rating).toBe(7); // 10 − 3, NOT the crit's 2
    expect(acc.specialsActivated).toContain(`crash-and-burn:${moto.id}`);
  });

  it("damage that finishes the squad forces its Attack to 0 (RULES §3)", () => {
    const moto = { ...motorcycleSquad(), rating: 2 };
    const board: BoardState = { objectives: [], threats: [moto] };
    const acc = applyOneAllocation(emptyAccumulator(board, 0), { kind: "special", specialId: `crash-and-burn:${moto.id}`, targetId: moto.id, units: 3 });
    expect(acc.board.threats[0]!).toMatchObject({ rating: 0, attack: 0 });
  });

  it("a sheet SPECIAL (non-board id) records but does NOT touch the board", () => {
    const moto = motorcycleSquad();
    const board: BoardState = { objectives: [], threats: [moto] };
    const acc = applyOneAllocation(emptyAccumulator(board, 0), { kind: "special", specialId: "flint-ravenous", targetId: moto.id, units: 2 });
    expect(acc.board.threats[0]!.rating).toBe(10); // untouched
    expect(acc.specialsActivated).toContain("flint-ravenous");
  });
});

describe("allocation: 'Painless' challenge bump (Einherjar, issue #19)", () => {
  // The Einherjar prints no Challenge; 'Painless' (rulebook p55) raises it per Reich 1 for the
  // action. challengeBump carries that raise into the soak, on top of any printed Challenge.
  const fold = (board: BoardState, allocs: ReadonlyArray<Parameters<typeof applyOneAllocation>[1]>, bump?: Record<string, number>) =>
    allocs.reduce(applyOneAllocation, emptyAccumulator(board, 0, bump));

  it("a +2 raise soaks 2 units before the Einherjar's rating drops", () => {
    const e = einherjar(); // rating 7, no printed Challenge
    const board: BoardState = { objectives: [], threats: [e] };
    const acc = fold(board, [{ kind: "eliminate", targetId: e.id, units: 5 }], { [e.id]: 2 });
    // 5 units − 2 soaked = 3 rating shed → 7 → 4.
    expect(acc.board.threats[0]!.rating).toBe(4);
    expect(acc.challengeConsumed[e.id]).toBe(2);
  });

  it("stacks on top of a printed Challenge", () => {
    const e = { ...einherjar(), challenge: 1 }; // printed 1 + raise 2 = 3 to soak
    const board: BoardState = { objectives: [], threats: [e] };
    const acc = fold(board, [{ kind: "eliminate", targetId: e.id, units: 5 }], { [e.id]: 2 });
    expect(acc.board.threats[0]!.rating).toBe(7 - (5 - 3)); // 7 → 5
    expect(acc.challengeConsumed[e.id]).toBe(3);
  });

  it("depletes across the turn — a second die past the cap chips rating", () => {
    const e = einherjar();
    const board: BoardState = { objectives: [], threats: [e] };
    // Two 1-unit dice with a +1 raise: first is fully soaked, second chips rating.
    const acc = fold(
      board,
      [{ kind: "eliminate", targetId: e.id, units: 1 }, { kind: "eliminate", targetId: e.id, units: 1 }],
      { [e.id]: 1 },
    );
    expect(acc.challengeConsumed[e.id]).toBe(1); // cap was 1, fully consumed
    expect(acc.board.threats[0]!.rating).toBe(6); // 7 → 6 (one unit got through)
  });

  it("no bump → behaves exactly as the printed value (regression)", () => {
    const e = einherjar();
    const board: BoardState = { objectives: [], threats: [e] };
    const acc = fold(board, [{ kind: "eliminate", targetId: e.id, units: 3 }]);
    expect(acc.board.threats[0]!.rating).toBe(4); // full 3 shed, nothing soaked
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

describe("rendInjury — Werhund 'Rending Claws' (rulebook p64, issue #24)", () => {
  it("escalates a normal one-box Injury to fill the whole category (box 2, penalty)", () => {
    const normal = resolveInjury(1, emptyInjuryTrack(), 1); // 1 leftover, d6=1 → category 0, box 1
    expect(normal).toMatchObject({ kind: "injury", category: 0, box: 1, penaltyTriggered: false });
    const rent = rendInjury(normal);
    // Same category, but now the full category fills and the 2nd-box penalty fires —
    // Downed-like severity, yet still an Injury (not a Downed).
    expect(rent).toEqual({ kind: "injury", category: 0, box: 2, penaltyTriggered: true });
  });

  it("keeps the category the normal injury landed in (a 2nd-box hit just re-asserts box 2)", () => {
    const second = resolveInjury(2, [1, 0, 0], 1); // category 0 already has box 1 → marks box 2
    expect(second).toMatchObject({ kind: "injury", category: 0, box: 2 });
    expect(rendInjury(second)).toEqual({ kind: "injury", category: 0, box: 2, penaltyTriggered: true });
  });

  it("leaves a Downed, death, or no-injury outcome untouched — there is nothing to escalate", () => {
    const downed = resolveInjury(3, emptyInjuryTrack(), 5); // 3 leftover → Downed
    expect(rendInjury(downed)).toBe(downed);
    const death = resolveInjury(1, [2, 2, 2], 1); // nowhere free → death
    expect(rendInjury(death)).toEqual({ kind: "death" });
    const none = resolveInjury(0, emptyInjuryTrack(), 1);
    expect(rendInjury(none)).toEqual({ kind: "none" });
  });
});

describe("rendingClawsInPlay — Werhund predicate (issue #24)", () => {
  it("is true while a Werhund is in play", () => {
    expect(rendingClawsInPlay([werhund()])).toBe(true);
    expect(rendingClawsInPlay([naziSquad(), werhund()])).toBe(true);
  });

  it("is false with no Werhund, or a staged/defeated one (gated on threatInPlay)", () => {
    expect(rendingClawsInPlay([naziSquad()])).toBe(false);
    expect(rendingClawsInPlay([{ ...werhund(), active: false }])).toBe(false);
    expect(rendingClawsInPlay([{ ...werhund(), rating: 0 }])).toBe(false);
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
