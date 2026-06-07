import { describe, it, expect } from "vitest";
import type { DieFace, Objective, ActionContext } from "../../domain/types.js";
import { sequenceRoller } from "../../domain/dice.js";
import {
  buildPlayerPool,
  buildGmPool,
  resolvePlayerDice,
  gmSuccesses,
  applyAllocations,
  injuryCheck,
  reinforce,
  availableCritSpecials,
  type Allocation,
  type BoardState,
} from "../index.js";
import { emptyInjuryTrack } from "../injury.js";
import { CHUCK } from "../../data/characters.js";
import { infantrySquad, policePatrol, naziSquad } from "../../data/threats.js";

/**
 * RULES.md §12 — the golden tests. These are drawn from the rulebook's own numbers
 * and are the engine's correctness contract. If one of these breaks, the engine is
 * wrong, not the test.
 */

describe("Golden A — Iryna clock-tower turn", () => {
  it("reduces the objective to 3 and takes no injury", () => {
    // Scene: Objective "Take cover inside the museum" rating 6;
    //        Threat "nazi squad" rating 4, Attack 3.
    const objective: Objective = {
      id: "take-cover",
      name: "Take cover inside the museum",
      kind: "objective",
      rating: 6,
    };
    const threat = naziSquad();

    // BUILD_PLAYER_POOL: 6 = SHOOT 3 + rifle(1) + runes(1) + (+elevated) bonus(1).
    const pool = buildPlayerPool({
      stat: { name: "SHOOT", rating: 3 },
      equipment: [
        { label: "rifle", bonusPlus: 1, bonusSatisfied: true }, // +elevated
        { label: "runes" }, // runes used (+1); ++concealed not yet satisfied
      ],
    });
    expect(pool.total).toBe(6);

    // BUILD_GM_POOL: one Threat in play, no others → its Attack = 3.
    const gmPool = buildGmPool([threat]);
    expect(gmPool).toBe(3);

    // ROLL (injected): player 6,5,4,2,2,1 ; GM 6,4,1.
    const player: DieFace[] = [6, 5, 4, 2, 2, 1];
    const gm: DieFace[] = [6, 4, 1];

    // DISCARD ≤3 → player survivors 6,5,4 ; GM successes 6,4 (two).
    const { survivors } = resolvePlayerDice(player);
    expect(survivors.map((d) => d.face)).toEqual([6, 5, 4]);
    const gmSucc = gmSuccesses(gm);
    expect(gmSucc.length).toBe(2);

    // ALLOCATE: 4 → Objective (6→5); 5 → Objective (5→4);
    //           6 (crit) → Defend (removes 2 GM dice → GM Attack 0).
    const board: BoardState = { objectives: [objective], threats: [threat] };
    const allocations: Allocation[] = [
      { kind: "advance", targetId: objective.id, units: 1 }, // the 4
      { kind: "advance", targetId: objective.id, units: 1 }, // the 5
      { kind: "defend", units: 2 }, // the 6 (crit) removes 2 GM dice
    ];
    const r1 = applyAllocations(board, allocations, gmSucc.length);
    expect(r1.board.objectives[0]!.rating).toBe(4);
    expect(r1.gmDiceRemaining).toBe(0);

    // Mid-allocation: Explosive Runes (++concealed) now satisfied → roll 2 bonus
    // dice 4,2; discard the 2; allocate the 4 → Objective (4→3).
    const bonus = sequenceRoller([4, 2]).roll(2);
    const { survivors: bonusSurv } = resolvePlayerDice(bonus);
    expect(bonusSurv.map((d) => d.face)).toEqual([4]);
    const r2 = applyAllocations(
      r1.board,
      [{ kind: "advance", targetId: objective.id, units: 1 }],
      r1.gmDiceRemaining,
    );
    expect(r2.board.objectives[0]!.rating).toBe(3);

    // INJURY_CHECK: GM Attack 0 → no Injury.
    const outcome = injuryCheck(
      r2.gmDiceRemaining,
      emptyInjuryTrack(),
      sequenceRoller([]),
    );
    expect(outcome.kind).toBe("none");
  });
});

describe("Golden B — Reinforcements", () => {
  // In play: Infantry Squad (rating 6, Attack 3) + Police Patrol (rating 4, Attack 2).
  // This round Astrid deals 4 and Chuck deals 2 to the Squad → Squad rating 0.
  it("derives the mid-round GM pool correctly while the Squad is dead vs alive", () => {
    const squad = infantrySquad();
    const police = policePatrol();

    // Squad reduced to 0 this round.
    const board: BoardState = { objectives: [], threats: [squad, police] };
    const killed = applyAllocations(
      board,
      [{ kind: "eliminate", targetId: squad.id, units: 6 }],
      0,
    );
    const deadSquad = killed.board.threats.find((t) => t.id === squad.id)!;
    const livePolice = killed.board.threats.find((t) => t.id === police.id)!;
    expect(deadSquad.rating).toBe(0);
    expect(deadSquad.attack).toBe(0); // rating 0 → Attack 0

    // A later objective roll that round: Squad at 0 → GM rolls 2 (Police Attack),
    // NOT 3.
    expect(buildGmPool([deadSquad, livePolice])).toBe(2);

    // Had the Squad still been alive: 4 = Squad Attack 3 + 1 for the extra Threat.
    expect(buildGmPool([squad, police])).toBe(4);
  });

  it("end-of-round: Police +1 → 3; Squad regains 1d6 rating and Attack floor(3/2)=1", () => {
    const squad = infantrySquad(); // starting Attack 3
    const police = policePatrol();

    // Squad was reduced to 0 this round (so its rating is 0, attack 0 going in).
    const deadSquad = { ...squad, rating: 0, attack: 0 };

    const result = reinforce({
      threats: [deadSquad, police],
      reducedToZeroThisRound: new Set([squad.id]),
      roller: sequenceRoller([4]), // the 1d6 rating restore
    });

    const outSquad = result.threats.find((t) => t.id === squad.id)!;
    const outPolice = result.threats.find((t) => t.id === police.id)!;

    expect(outPolice.attack).toBe(3); // 2 + 1 (closing in)
    expect(outSquad.attack).toBe(1); // floor(startingAttack 3 / 2)
    expect(outSquad.rating).toBe(4); // 0 + 1d6(4)
  });
});

describe("Golden C — Challenge", () => {
  it("4 successes vs a Challenge-1 objective nets 3 rating reduction", () => {
    const objective: Objective = {
      id: "wire-the-charges",
      name: "Wire the charges",
      kind: "objective",
      rating: 10,
      challenge: 1,
    };
    const board: BoardState = { objectives: [objective], threats: [] };

    const result = applyAllocations(
      board,
      [{ kind: "advance", targetId: objective.id, units: 4 }],
      0,
    );
    expect(result.board.objectives[0]!.rating).toBe(7); // 10 − (4 − 1)

    // Per vampire, per turn: the next vampire faces the full Challenge again.
    const next = applyAllocations(
      result.board,
      [{ kind: "advance", targetId: objective.id, units: 4 }],
      0,
    );
    expect(next.board.objectives[0]!.rating).toBe(4); // 7 − (4 − 1)
  });
});

describe("Golden D — Downed vs Injury", () => {
  it("2 GM dice left → one Injury (tick a box)", () => {
    // d6 = 3 → default category 1; first open box → box 1.
    const outcome = injuryCheck(2, emptyInjuryTrack(), sequenceRoller([3]));
    expect(outcome).toEqual({
      kind: "injury",
      category: 1,
      box: 1,
      penaltyTriggered: false,
    });
  });

  it("3 GM dice left → Downed (rescue Secondary Objective rating 2–4)", () => {
    const outcome = injuryCheck(3, emptyInjuryTrack(), sequenceRoller([5]), {
      rescueObjectiveRating: 3,
    });
    expect(outcome.kind).toBe("downed");
    if (outcome.kind === "downed") {
      expect(outcome.category).toBe(2); // d6 = 5 → category 2
      expect(outcome.rescueObjectiveRating).toBeGreaterThanOrEqual(2);
      expect(outcome.rescueObjectiveRating).toBeLessThanOrEqual(4);
    }
  });
});

describe("Golden E — SPECIAL gating (Chuck's Elbow Grease)", () => {
  const unlocked = new Set(["chuck-elbow-grease"]); // advance unlocked

  it("is offered as a crit-target ONLY on a solo FIX Objective action", () => {
    const offered = availableCritSpecials(
      CHUCK,
      { stat: "FIX", targetKind: "objective", solo: true },
      unlocked,
    );
    expect(offered.map((s) => s.id)).toContain("chuck-elbow-grease");
  });

  it("never appears on a non-FIX or non-solo or non-Objective action", () => {
    const ctxs: ActionContext[] = [
      { stat: "FIX", targetKind: "objective", solo: false },
      { stat: "BRAWL", targetKind: "objective", solo: true },
      { stat: "FIX", targetKind: "threat", solo: true },
    ];
    for (const ctx of ctxs) {
      const offered = availableCritSpecials(CHUCK, ctx, unlocked);
      expect(offered.map((s) => s.id)).not.toContain("chuck-elbow-grease");
    }
  });
});
