import { describe, it, expect } from "vitest";
import { processIntent } from "../handler.js";
import type { EventInput } from "../handler.js";
import type { Intent } from "../messages.js";
import { FREEFORM_MAX_DICE } from "../messages.js";
import { initialState } from "../../state/init.js";
import { applyEvent } from "../../state/reducer.js";
import { makeEvent } from "../../events/types.js";
import type { Actor, GameEvent } from "../../events/types.js";
import { sequenceRoller } from "../../domain/dice.js";
import type { DiceRoller } from "../../domain/dice.js";
import type { DieFace, Objective, Threat } from "../../domain/types.js";
import { werhund, stahlsoldat } from "../../data/threats.js";
import { CHARACTERS_BY_ID } from "../../data/characters.js";
import { activeMantle, effectiveStats } from "../../state/stances.js";

const objective: Objective = { id: "obj1", name: "Take cover", kind: "objective", rating: 6 };
const threat: Threat = { id: "thr1", name: "Nazi Squad", kind: "threat", rating: 4, attack: 3, startingAttack: 3, reinforces: true, restoresAtZero: true };

/** Minimal server harness: process an intent, fold its events back into state. */
function makeDriver(gameId = "g") {
  let seq = 0;
  let state = initialState(gameId);
  const emit = (events: EventInput[], actorDefault: Actor) => {
    for (const ei of events) {
      seq++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = makeEvent({ id: `e${seq}`, gameId, seq, actor: ei.actor ?? actorDefault, ts: seq }, ei.type, ei.payload as any) as GameEvent;
      state = applyEvent(state, e);
    }
  };
  return {
    get state() {
      return state;
    },
    run(intent: Intent, roller: DiceRoller = sequenceRoller([]), actor: Actor = "gm") {
      const r = processIntent(state, intent, { roller, now: seq * 1000, actor });
      if (!r.ok) throw new Error(r.error);
      emit(r.events, actor);
      return r.events;
    },
    fail(intent: Intent, actor: Actor = "gm") {
      return processIntent(state, intent, { roller: sequenceRoller([]), now: 0, actor });
    },
    /** Fold raw events straight into state (test setup that has no intent path). */
    seed(events: EventInput[], actor: Actor = "gm") {
      emit(events, actor);
    },
  };
}

describe("processIntent — server rolls the dice (anti-fudge)", () => {
  it("the player roll casts only the player pool, but builds + shows the GM pool", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");

    // The player rolls their 6 dice; the Reich's pool is built (and recorded) but NOT
    // thrown yet — that's the GM's separate beat (issue #5).
    const events = d.run({ kind: "roll", playerPoolDice: 6 }, sequenceRoller([6, 5, 4, 2, 2, 1]), "iryna");

    const byType = (t: string) => events.filter((e) => e.type === t);
    expect(byType("POOL_BUILT").map((e) => e.payload)).toEqual([
      { who: "player", dice: 6, sources: [] },
      { who: "gm", dice: 3 }, // server computed from the in-play Threat's Attack
    ]);
    expect(byType("DICE_ROLLED").map((e) => e.payload)).toEqual([
      { who: "player", results: [6, 5, 4, 2, 2, 1] }, // no GM roll in this event batch
    ]);
    expect(d.state.currentTurn?.gmDice).toBeUndefined(); // the Reich hasn't rolled
    expect(d.state.currentTurn?.gmPoolSize).toBe(3);
  });

  it("roll_gm then throws the Reich's pool of the recorded size", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    d.run({ kind: "roll", playerPoolDice: 6 }, sequenceRoller([6, 5, 4, 2, 2, 1]), "iryna");

    const gmEvents = d.run({ kind: "roll_gm" }, sequenceRoller([6, 4, 1]), "gm");
    expect(gmEvents.map((e) => e.type)).toEqual(["DICE_ROLLED"]);
    expect(gmEvents[0]?.payload).toEqual({ who: "gm", results: [6, 4, 1] });
    expect(d.state.currentTurn?.gmDice).toEqual([6, 4, 1]);
  });

  it("roll_gm takes GM-supplied GoDice faces as the truth instead of rolling (issue #50)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    d.run({ kind: "roll", playerPoolDice: 6 }, sequenceRoller([6, 5, 4, 2, 2, 1]), "iryna"); // builds a 3-die Reich pool

    // The roller hands back [1,1,1] — but the GM read [5,2,6] off their physical dice, and that wins.
    const gmEvents = d.run({ kind: "roll_gm", results: [5, 2, 6] }, sequenceRoller([1, 1, 1]), "gm");
    expect(gmEvents.map((e) => e.type)).toEqual(["DICE_ROLLED"]);
    expect(gmEvents[0]?.payload).toEqual({ who: "gm", results: [5, 2, 6] });
    expect(d.state.currentTurn?.gmDice).toEqual([5, 2, 6]);
  });

  it("rejects GoDice faces of the wrong count or out of the 1-6 range (issue #50)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    d.run({ kind: "roll", playerPoolDice: 6 }, sequenceRoller([6, 5, 4, 2, 2, 1]), "iryna"); // 3-die Reich pool

    expect(d.fail({ kind: "roll_gm", results: [5, 2] }).ok).toBe(false); // too few
    expect(d.fail({ kind: "roll_gm", results: [5, 2, 6, 1] }).ok).toBe(false); // too many
    expect(d.fail({ kind: "roll_gm", results: [5, 2, 7] as never }).ok).toBe(false); // 7 is not a face
    expect(d.fail({ kind: "roll_gm", results: [5, 2, 0] as never }).ok).toBe(false); // 0 is not a face
  });

  it("an uncontested action (no Threat in play) resolves the empty Reich pool with the player roll", () => {
    const d = makeDriver();
    // No Threats on the board → the Reich has nothing to roll (RULES §4 BUILD_GM_POOL).
    d.run({ kind: "frame_scene", objectives: [objective], threats: [] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");

    const events = d.run({ kind: "roll", playerPoolDice: 4 }, sequenceRoller([6, 5, 2, 1]), "iryna");
    // 0 GM dice → the player roll already carries the empty GM roll; no GM beat to wait on.
    expect(events.filter((e) => e.type === "DICE_ROLLED").map((e) => e.payload)).toEqual([
      { who: "player", results: [6, 5, 2, 1] },
      { who: "gm", results: [] },
    ]);
    expect(d.state.currentTurn?.gmDice).toEqual([]);
  });

  it("rejects rolling with no turn in progress", () => {
    const d = makeDriver();
    const r = d.fail({ kind: "roll", playerPoolDice: 4 });
    expect(r.ok).toBe(false);
  });

  it("rejects roll_gm before the player has rolled, and again once the Reich has rolled", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    expect(d.fail({ kind: "roll_gm" }).ok).toBe(false); // player hasn't rolled

    d.run({ kind: "roll", playerPoolDice: 2 }, sequenceRoller([5, 4]), "iryna");
    d.run({ kind: "roll_gm" }, sequenceRoller([6, 4, 1]), "gm");
    expect(d.fail({ kind: "roll_gm" }).ok).toBe(false); // already rolled
  });
});

describe("processIntent — full §12-A turn driven by intents", () => {
  it("reduces the Objective 6 → 3 and takes no Injury", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    d.run({ kind: "roll", playerPoolDice: 6 }, sequenceRoller([6, 5, 4, 2, 2, 1]), "iryna");
    d.run({ kind: "roll_gm" }, sequenceRoller([6, 4, 1]), "gm");
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "iryna");
    d.run(
      {
        kind: "allocate",
        allocations: [
          { kind: "advance", targetId: "obj1", units: 1 },
          { kind: "advance", targetId: "obj1", units: 1 },
          { kind: "defend", units: 2 },
        ],
      },
      sequenceRoller([]),
      "iryna",
    );
    // mid-allocation bonus die lands
    d.run({ kind: "allocate", allocations: [{ kind: "advance", targetId: "obj1", units: 1 }] }, sequenceRoller([]), "iryna");
    d.run({ kind: "commit" }, sequenceRoller([]), "iryna");

    expect(d.state.board.objectives[0]?.rating).toBe(3);
    expect(d.state.characters.iryna.injuries).toEqual([0, 0, 0]);
    expect(d.state.actedThisRound).toEqual(["iryna"]);
    expect(d.state.currentTurn).toBeNull();
  });

  it("commit parks the injury for the INJURY_CHECK window; resolve_injury then applies it", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "astrid", stat: "BRAWL" }, sequenceRoller([]), "astrid");
    // player rolls two successes, GM rolls 6,6,4 = 3 successes
    d.run({ kind: "roll", playerPoolDice: 3 }, sequenceRoller([5, 4, 2]), "astrid");
    d.run({ kind: "roll_gm" }, sequenceRoller([6, 6, 4]), "gm");
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "astrid");
    // allocate both successes to the objective (no Defend) → 3 GM dice remain
    d.run({ kind: "allocate", allocations: [{ kind: "advance", targetId: "obj1", units: 1 }, { kind: "advance", targetId: "obj1", units: 1 }] }, sequenceRoller([]), "astrid");
    // A die got through → commit OPENS the window without rolling; the category die is its own throw.
    const opened = d.run({ kind: "commit" }, sequenceRoller([]), "astrid");
    expect(opened.map((e) => e.type)).toEqual(["INJURY_CHECK_OPENED"]);
    expect(d.state.currentTurn?.phase).toBe("INJURY_CHECK");
    expect(d.state.currentTurn?.pendingInjury).toBeUndefined(); // not thrown yet

    // 3 leftover → Downed; category from d6=5 → category 2. roll_injury PARKS it.
    const parked = d.run({ kind: "roll_injury" }, sequenceRoller([5]), "astrid");
    expect(parked.map((e) => e.type)).toEqual(["INJURY_PENDING"]);
    expect(d.state.characters.astrid.downed).toBe(false); // not applied yet — the window is open
    expect(d.state.currentTurn?.pendingInjury).toMatchObject({ face: 5, outcome: { kind: "downed", category: 2 } });
    expect(d.state.actedThisRound).toEqual([]); // turn hasn't closed

    // Resolving applies the box, auto-spawns the (unrevealed) rescue Objective, and closes the turn.
    const resolved = d.run({ kind: "resolve_injury" }, sequenceRoller([]), "astrid");
    expect(resolved.map((e) => e.type)).toEqual(["DOWNED", "SECONDARY_OBJECTIVE_ADDED", "ALLOCATION_COMMITTED"]);
    expect(d.state.characters.astrid.downed).toBe(true);
    expect(d.state.characters.astrid.injuries[2]).toBe(2); // all boxes in category 2

    // Issue #16: a rescue Secondary is created automatically, UNREVEALED (the GM sets its rating),
    // tied to the downed vampire, and its id is stamped on the runtime + the DOWNED event.
    const rescue = d.state.board.secondaryObjectives.find((o) => o.rescueFor === "astrid");
    expect(rescue).toBeDefined();
    expect(rescue).toMatchObject({ rescueFor: "astrid", revealed: false, kind: "secondary" });
    expect(rescue!.rating).toBeGreaterThanOrEqual(2);
    expect(rescue!.rating).toBeLessThanOrEqual(4);
    expect(d.state.characters.astrid.rescueObjectiveId).toBe(rescue!.id);
    const downedEvt = resolved.find((e) => e.type === "DOWNED")!;
    expect((downedEvt.payload as { rescueObjectiveId?: string }).rescueObjectiveId).toBe(rescue!.id);

    expect(d.state.currentTurn).toBeNull();
    expect(d.state.actedThisRound).toEqual(["astrid"]);
  });
});

describe("Downed → rescue → capture lifecycle (issue #16)", () => {
  // Drive Astrid to Downed against a single objective, then probe the rescue/capture paths.
  function downAstrid(objectives: Objective[] = [objective]) {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives, threats: [threat] });
    d.run({ kind: "start_turn", seat: "astrid", stat: "BRAWL" }, sequenceRoller([]), "astrid");
    d.run({ kind: "roll", playerPoolDice: 3 }, sequenceRoller([5, 4, 2]), "astrid");
    d.run({ kind: "roll_gm" }, sequenceRoller([6, 6, 4]), "gm");
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "astrid");
    d.run({ kind: "allocate", allocations: [{ kind: "advance", targetId: "obj1", units: 1 }, { kind: "advance", targetId: "obj1", units: 1 }] }, sequenceRoller([]), "astrid");
    d.run({ kind: "commit" }, sequenceRoller([]), "astrid");
    d.run({ kind: "roll_injury" }, sequenceRoller([5]), "astrid"); // d6=5 → category 2, 3 leftover → Downed
    d.run({ kind: "resolve_injury" }, sequenceRoller([]), "astrid");
    return d;
  }

  it("completing the rescue Secondary brings the vampire back up (clears Downed + rescue pointer)", () => {
    const d = downAstrid();
    const rescueId = d.state.characters.astrid.rescueObjectiveId!;
    d.run({ kind: "complete_secondary_objective", id: rescueId });
    expect(d.state.characters.astrid.downed).toBe(false);
    expect(d.state.characters.astrid.captured).toBe(false);
    expect(d.state.characters.astrid.rescueObjectiveId).toBeUndefined();
  });

  it("completing the LAST main Objective while still Downed → captured", () => {
    const d = downAstrid();
    expect(d.state.characters.astrid.captured).toBe(false);
    const captured = d.run({ kind: "complete_objective", id: "obj1" });
    expect(captured.map((e) => e.type)).toEqual(["OBJECTIVE_COMPLETED", "CHARACTER_CAPTURED"]);
    expect(d.state.characters.astrid.captured).toBe(true);
    expect(d.state.characters.astrid.downed).toBe(true); // still out of the fight, just more severely
    const cap = captured.find((e) => e.type === "CHARACTER_CAPTURED")!;
    expect((cap.payload as { rescueObjectiveId?: string }).rescueObjectiveId).toBe(d.state.characters.astrid.rescueObjectiveId);
  });

  it("does NOT capture while another main Objective is still in play", () => {
    const d = downAstrid([objective, { id: "obj2", name: "Reach the vault", kind: "objective", rating: 4 }]);
    const events = d.run({ kind: "complete_objective", id: "obj1" });
    expect(events.map((e) => e.type)).toEqual(["OBJECTIVE_COMPLETED"]); // obj2 still open → no capture
    expect(d.state.characters.astrid.captured).toBe(false);
    // Clearing the last one now captures.
    const last = d.run({ kind: "complete_objective", id: "obj2" });
    expect(last.map((e) => e.type)).toEqual(["OBJECTIVE_COMPLETED", "CHARACTER_CAPTURED"]);
    expect(d.state.characters.astrid.captured).toBe(true);
  });

  it("a rescued vampire is NOT captured when the scene moves on", () => {
    const d = downAstrid();
    d.run({ kind: "complete_secondary_objective", id: d.state.characters.astrid.rescueObjectiveId! });
    const events = d.run({ kind: "complete_objective", id: "obj1" });
    expect(events.map((e) => e.type)).toEqual(["OBJECTIVE_COMPLETED"]); // no longer downed → no capture
    expect(d.state.characters.astrid.captured).toBe(false);
  });
});

describe("processIntent — secondary-objective reward menu auto-apply (issue #37)", () => {
  // A board with a primary Objective, a Threat (rating 6, attack 3, challenge 2), and a plain secondary.
  function boardWithSecondary() {
    const d = makeDriver();
    d.run({
      kind: "frame_scene",
      objectives: [{ id: "primary", name: "Plant the charges", kind: "objective", rating: 8, challenge: 2 }],
      threats: [{ id: "tank", name: "Panzer", kind: "threat", rating: 6, attack: 3, startingAttack: 3, challenge: 2, reinforces: true, restoresAtZero: true }],
      secondaryObjectives: [{ id: "sec", name: "Free the prisoners", kind: "secondary", rating: 3 }],
    });
    return d;
  }

  it("'reduce a primary Objective by D6' rolls the d6 and cuts the named Objective (bypassing Challenge)", () => {
    const d = boardWithSecondary();
    const events = d.run({ kind: "complete_secondary_objective", id: "sec", rewardChoice: "reduce-objective-d6", rewardTargetId: "primary" }, sequenceRoller([5]));
    expect(events.map((e) => e.type)).toEqual(["SECONDARY_OBJECTIVE_COMPLETED", "SECONDARY_OBJECTIVE_REWARD_APPLIED"]);
    expect(d.state.board.objectives.find((o) => o.id === "primary")!.rating).toBe(3); // 8 − 5, Challenge ignored
  });

  it("'reduce a Threat by D6' cuts rating; a kill forces Attack to 0", () => {
    const d = boardWithSecondary();
    d.run({ kind: "complete_secondary_objective", id: "sec", rewardChoice: "reduce-threat-d6", rewardTargetId: "tank" }, sequenceRoller([6]));
    const tank = d.state.board.threats.find((t) => t.id === "tank")!;
    expect(tank.rating).toBe(0); // 6 − 6
    expect(tank.attack).toBe(0); // rating 0 → attack 0
  });

  it("'gain D6 Blood' rolls and banks Blood on the named seat", () => {
    const d = boardWithSecondary();
    d.run({ kind: "complete_secondary_objective", id: "sec", rewardChoice: "gain-blood-d6", rewardSeat: "iryna" }, sequenceRoller([4]));
    expect(d.state.characters.iryna.blood).toBe(4);
  });

  it("'reduce a Threat's Attack by 2' is a fixed cut (no roll)", () => {
    const d = boardWithSecondary();
    d.run({ kind: "complete_secondary_objective", id: "sec", rewardChoice: "reduce-attack-2", rewardTargetId: "tank" });
    expect(d.state.board.threats.find((t) => t.id === "tank")!.attack).toBe(1); // 3 − 2
  });

  it("'reduce a Challenge by 1' drops the named target's Challenge via lowerChallenge", () => {
    const d = boardWithSecondary();
    d.run({ kind: "complete_secondary_objective", id: "sec", rewardChoice: "reduce-challenge-1", rewardTargetId: "primary" });
    expect(d.state.board.objectives.find((o) => o.id === "primary")!.challenge).toBe(1); // 2 − 1
  });

  it("the −1 Challenge reward is a no-op against a Werhund's locked Challenge (anti-fudge — emits nothing)", () => {
    const d = makeDriver();
    const dog = { ...werhund(), id: "dog" } as Threat; // unlowerableChallenge, challenge 1
    d.run({ kind: "frame_scene", objectives: [], threats: [dog], secondaryObjectives: [{ id: "sec", name: "x", kind: "secondary", rating: 2 }] });
    const events = d.run({ kind: "complete_secondary_objective", id: "sec", rewardChoice: "reduce-challenge-1", rewardTargetId: "dog" });
    expect(events.map((e) => e.type)).toEqual(["SECONDARY_OBJECTIVE_COMPLETED"]); // no reward event
    expect(d.state.board.threats.find((t) => t.id === "dog")!.challenge).toBe(dog.challenge);
  });

  it("a reward with no named target just completes (records the choice, applies nothing)", () => {
    const d = boardWithSecondary();
    const events = d.run({ kind: "complete_secondary_objective", id: "sec", rewardChoice: "reduce-objective-d6" });
    expect(events.map((e) => e.type)).toEqual(["SECONDARY_OBJECTIVE_COMPLETED"]);
    expect(d.state.board.objectives.find((o) => o.id === "primary")!.rating).toBe(8); // untouched
  });

  it("'gain equipment' applies no auto-effect (it's the issue-#4 reward-gear path)", () => {
    const d = boardWithSecondary();
    const events = d.run({ kind: "complete_secondary_objective", id: "sec", rewardChoice: "gain-equipment" });
    expect(events.map((e) => e.type)).toEqual(["SECONDARY_OBJECTIVE_COMPLETED"]);
  });
});

describe("processIntent — GM whiff escalates the anchor at the action's conclusion (RULES §8)", () => {
  it("a Reich roll with zero successes bumps the anchor Threat's Attack by 1 at commit", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] }); // thr1: attack 3
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    d.run({ kind: "roll", playerPoolDice: 1 }, sequenceRoller([5]), "iryna"); // 1 player success
    d.run({ kind: "roll_gm" }, sequenceRoller([1, 2, 3]), "gm"); // 3 dice, ZERO successes → a whiff
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "iryna");
    d.run({ kind: "allocate", allocations: [{ kind: "advance", targetId: "obj1", units: 1 }] }, sequenceRoller([]), "iryna");

    // No GM die got through (zero successes), so the turn closes with no injury — but the
    // whiff presses the lead Threat right now, before ALLOCATION_COMMITTED.
    const events = d.run({ kind: "commit" }, sequenceRoller([]), "iryna");
    expect(events.map((e) => e.type)).toEqual(["GM_WHIFF", "ALLOCATION_COMMITTED"]);
    expect(events[0]).toMatchObject({ type: "GM_WHIFF", payload: { threatId: "thr1", name: "Nazi Squad", attack: 4 } });
    expect(d.state.board.threats[0]?.attack).toBe(4); // 3 → 4, immediately
    expect(d.state.currentTurn).toBeNull();
  });

  it("does NOT bump when the Reich rolled a success that was merely defended away", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    d.run({ kind: "roll", playerPoolDice: 1 }, sequenceRoller([5]), "iryna");
    d.run({ kind: "roll_gm" }, sequenceRoller([4, 2, 2]), "gm"); // one real success (the 4)
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "iryna");
    d.run({ kind: "allocate", allocations: [{ kind: "defend", units: 1 }] }, sequenceRoller([]), "iryna"); // shave it to 0

    const events = d.run({ kind: "commit" }, sequenceRoller([]), "iryna");
    expect(events.map((e) => e.type)).toEqual(["ALLOCATION_COMMITTED"]); // no whiff bump
    expect(d.state.board.threats[0]?.attack).toBe(3); // unchanged
  });

  it("a Paratrooper anchor whiff also climbs +2 rating (Rapid Deployment, #22)", () => {
    const para: Threat = { id: "para", name: "Paratrooper Squad", kind: "threat", rating: 6, attack: 3, startingAttack: 3, reinforces: true, restoresAtZero: true, rules: ["rapid-deployment"] };
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [para] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    d.run({ kind: "roll", playerPoolDice: 1 }, sequenceRoller([5]), "iryna");
    d.run({ kind: "roll_gm" }, sequenceRoller([1, 2, 3]), "gm"); // zero successes → a whiff
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "iryna");
    d.run({ kind: "allocate", allocations: [{ kind: "advance", targetId: "obj1", units: 1 }] }, sequenceRoller([]), "iryna");

    const events = d.run({ kind: "commit" }, sequenceRoller([]), "iryna");
    expect(events[0]).toMatchObject({ type: "GM_WHIFF", payload: { threatId: "para", attack: 4, rating: 8 } });
    expect(d.state.board.threats[0]).toMatchObject({ attack: 4, rating: 8 }); // ATK 3→4, rating 6→8
  });
});

describe("processIntent — SPECIAL self-buff applies its Blood", () => {
  it("a crit allocated to Flint's Ravenous grants +3 Blood, logged", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "flint", stat: "BRAWL" }, sequenceRoller([]), "flint");
    expect(d.state.characters.flint.blood).toBe(0);

    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "special", specialId: "flint-ravenous", units: 2 }] },
      sequenceRoller([]),
      "flint",
    );
    expect(events.map((e) => e.type)).toEqual(["DIE_ALLOCATED", "BLOOD_CHANGED"]);
    expect(events.find((e) => e.type === "BLOOD_CHANGED")?.payload).toMatchObject({ seat: "flint", delta: 3, reason: "Ravenous" });
    expect(d.state.characters.flint.blood).toBe(3);
  });

  it("a SPECIAL with no Blood grant (Iryna's Deadeye Shot) emits no BLOOD_CHANGED", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "special", specialId: "iryna-deadeye-shot", units: 2 }] },
      sequenceRoller([]),
      "iryna",
    );
    expect(events.map((e) => e.type)).toEqual(["DIE_ALLOCATED"]);
    expect(d.state.characters.iryna.blood).toBe(0);
  });
});

describe("processIntent — Deadeye Shot / Back-Pocket Hex −1 Threat Attack (#26)", () => {
  it("a crit on Iryna's Deadeye Shot, aimed at a Threat, drops its Attack by 1 (logged, GM-editable)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "special", specialId: "iryna-deadeye-shot", targetId: "thr1", units: 2 }] },
      sequenceRoller([]),
      "iryna",
    );
    expect(events.map((e) => e.type)).toEqual(["DIE_ALLOCATED", "THREAT_ATTACK_REDUCED"]);
    expect(events.find((e) => e.type === "THREAT_ATTACK_REDUCED")?.payload).toMatchObject({
      threatId: "thr1",
      threatName: "Nazi Squad",
      amount: 1,
      attack: 2, // 3 − 1, resolved
      specialId: "iryna-deadeye-shot",
      specialName: "Deadeye Shot",
    });
    expect(d.state.board.threats[0]?.attack).toBe(2);
  });

  it("Cosgrave's Back-Pocket Hex shaves a chosen Threat's Attack the same way", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "cosgrave", stat: "TERRIFY" }, sequenceRoller([]), "cosgrave");
    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "special", specialId: "cosgrave-back-pocket-hex", targetId: "thr1", units: 2 }] },
      sequenceRoller([]),
      "cosgrave",
    );
    expect(events.find((e) => e.type === "THREAT_ATTACK_REDUCED")?.payload).toMatchObject({ specialName: "Back-Pocket Hex", attack: 2 });
    expect(d.state.board.threats[0]?.attack).toBe(2);
  });

  it("no target Threat → just the activation, Attack untouched (the existing crit-without-pick path)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "special", specialId: "iryna-deadeye-shot", units: 2 }] },
      sequenceRoller([]),
      "iryna",
    );
    expect(events.map((e) => e.type)).toEqual(["DIE_ALLOCATED"]);
    expect(d.state.board.threats[0]?.attack).toBe(3);
  });

  it("two Attack-shaving crits on one Threat compose and clamp at 0", () => {
    const lowAtk: Threat = { ...threat, attack: 1 };
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [lowAtk] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    const events = d.run(
      {
        kind: "allocate",
        allocations: [
          { kind: "special", specialId: "iryna-deadeye-shot", targetId: "thr1", units: 2 },
          { kind: "special", specialId: "iryna-deadeye-shot", targetId: "thr1", units: 2 },
        ],
      },
      sequenceRoller([]),
      "iryna",
    );
    const resolved = events.filter((e) => e.type === "THREAT_ATTACK_REDUCED").map((e) => e.payload.attack);
    expect(resolved).toEqual([0, 0]); // 1 → 0, then the second clamps (stays 0)
    expect(d.state.board.threats[0]?.attack).toBe(0);
  });
});

describe("processIntent — Apex Predator −3 Threat rating (#27)", () => {
  it("a crit on Astrid's Apex Predator carries server-authoritative ratingDamage to the board", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] }); // thr1 rating 4
    d.run({ kind: "start_turn", seat: "astrid", stat: "BRAWL" }, sequenceRoller([]), "astrid");
    const events = d.run(
      // The client's bogus ratingDamage (99) is IGNORED — the handler recomputes 3 from the descriptor.
      { kind: "allocate", allocations: [{ kind: "special", specialId: "astrid-apex-predator", targetId: "thr1", units: 2, ratingDamage: 99 }] },
      sequenceRoller([]),
      "astrid",
    );
    expect(events.map((e) => e.type)).toEqual(["DIE_ALLOCATED"]); // no separate event — rides the allocation
    expect(events[0]?.payload).toMatchObject({ kind: "special", specialId: "astrid-apex-predator", targetId: "thr1", ratingDamage: 3 });
    expect(d.state.board.threats[0]?.rating).toBe(1); // 4 − 3
  });

  it("Apex Predator that finishes a Threat forces its Attack to 0", () => {
    const weak: Threat = { ...threat, rating: 2 };
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [weak] });
    d.run({ kind: "start_turn", seat: "astrid", stat: "BRAWL" }, sequenceRoller([]), "astrid");
    d.run(
      { kind: "allocate", allocations: [{ kind: "special", specialId: "astrid-apex-predator", targetId: "thr1", units: 2 }] },
      sequenceRoller([]),
      "astrid",
    );
    expect(d.state.board.threats[0]).toMatchObject({ rating: 0, attack: 0 });
  });

  it("no target Threat → just the activation, no ratingDamage emitted", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "astrid", stat: "BRAWL" }, sequenceRoller([]), "astrid");
    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "special", specialId: "astrid-apex-predator", units: 2 }] },
      sequenceRoller([]),
      "astrid",
    );
    expect(events[0]?.payload).not.toHaveProperty("ratingDamage");
    expect(d.state.board.threats[0]?.rating).toBe(4);
  });
});

describe("processIntent — Unnatural Endurance −3 GM Attack dice (#28)", () => {
  it("a crit on Astrid's Unnatural Endurance sheds 3 GM dice, so commit closes with no Injury", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] }); // attack 3 → GM pool 3
    d.run({ kind: "start_turn", seat: "astrid", stat: "BRAWL" }, sequenceRoller([]), "astrid");
    d.run({ kind: "roll", playerPoolDice: 1 }, sequenceRoller([6]), "astrid"); // a crit to spend on the SPECIAL
    d.run({ kind: "roll_gm" }, sequenceRoller([6, 6, 4]), "gm"); // 3 GM successes → gmDiceRemaining 3
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "astrid");
    const events = d.run(
      // bogus client gmDiceReduction (99) is IGNORED — the handler recomputes 3 from the descriptor.
      { kind: "allocate", allocations: [{ kind: "special", specialId: "astrid-unnatural-endurance", units: 2, gmDiceReduction: 99 }] },
      sequenceRoller([]),
      "astrid",
    );
    expect(events.map((e) => e.type)).toEqual(["DIE_ALLOCATED"]); // no separate event — rides the allocation
    expect(events[0]?.payload).toMatchObject({ kind: "special", specialId: "astrid-unnatural-endurance", gmDiceReduction: 3 });
    expect(d.state.currentTurn?.gmDiceRemaining).toBe(0); // 3 − 3
    // No GM die gets through → commit closes the turn outright (no INJURY_CHECK window).
    const committed = d.run({ kind: "commit" }, sequenceRoller([]), "astrid");
    expect(committed.map((e) => e.type)).toEqual(["ALLOCATION_COMMITTED"]);
    expect(d.state.characters.astrid.injuries).toEqual([0, 0, 0]);
  });
});

describe("processIntent — Sapper −1 Objective/Threat Challenge (#29)", () => {
  const guardedThreat: Threat = { ...threat, challenge: 2 };
  const guardedObjective: Objective = { ...objective, challenge: 2 };

  it("a crit on Nicole's Sapper, aimed at a Threat, lowers its Challenge by 1 (logged, GM-editable)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [guardedThreat] });
    d.run({ kind: "start_turn", seat: "nicole", stat: "FIX", tags: ["explosives"] }, sequenceRoller([]), "nicole");
    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "special", specialId: "nicole-sapper", targetId: "thr1", units: 2 }] },
      sequenceRoller([]),
      "nicole",
    );
    expect(events.map((e) => e.type)).toEqual(["DIE_ALLOCATED", "CHALLENGE_REDUCED"]);
    expect(events.find((e) => e.type === "CHALLENGE_REDUCED")?.payload).toMatchObject({
      targetId: "thr1",
      targetName: "Nazi Squad",
      targetKind: "threat",
      amount: 1,
      challenge: 1, // 2 − 1, resolved
      specialId: "nicole-sapper",
      specialName: "Sapper",
    });
    expect(d.state.board.threats[0]?.challenge).toBe(1);
  });

  it("aimed at an Objective, it lowers the Objective's Challenge the same way", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [guardedObjective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "nicole", stat: "FIX", tags: ["explosives"] }, sequenceRoller([]), "nicole");
    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "special", specialId: "nicole-sapper", targetId: "obj1", units: 2 }] },
      sequenceRoller([]),
      "nicole",
    );
    expect(events.find((e) => e.type === "CHALLENGE_REDUCED")?.payload).toMatchObject({ targetId: "obj1", targetKind: "objective", challenge: 1 });
    expect(d.state.board.objectives[0]?.challenge).toBe(1);
  });

  it("no target → just the activation, no Challenge change", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [guardedThreat] });
    d.run({ kind: "start_turn", seat: "nicole", stat: "FIX", tags: ["explosives"] }, sequenceRoller([]), "nicole");
    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "special", specialId: "nicole-sapper", units: 2 }] },
      sequenceRoller([]),
      "nicole",
    );
    expect(events.map((e) => e.type)).toEqual(["DIE_ALLOCATED"]);
    expect(d.state.board.threats[0]?.challenge).toBe(2);
  });

  it("honours the Werhund's 'Unlowerable Challenge' (#25): targeting it emits nothing, Challenge unchanged", () => {
    const dog = { ...werhund(), id: "thr1" } as Threat; // challenge 1, unlowerableChallenge true
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [dog] });
    d.run({ kind: "start_turn", seat: "nicole", stat: "FIX", tags: ["explosives"] }, sequenceRoller([]), "nicole");
    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "special", specialId: "nicole-sapper", targetId: "thr1", units: 2 }] },
      sequenceRoller([]),
      "nicole",
    );
    expect(events.map((e) => e.type)).toEqual(["DIE_ALLOCATED"]); // no CHALLENGE_REDUCED — the lock held
    expect(d.state.board.threats[0]?.challenge).toBe(1);
  });

  it("two explosives crits on one target compose and clamp at 0", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [{ ...threat, challenge: 1 }] });
    d.run({ kind: "start_turn", seat: "nicole", stat: "FIX", tags: ["explosives"] }, sequenceRoller([]), "nicole");
    const events = d.run(
      {
        kind: "allocate",
        allocations: [
          { kind: "special", specialId: "nicole-sapper", targetId: "thr1", units: 2 },
          { kind: "special", specialId: "nicole-sapper", targetId: "thr1", units: 2 },
        ],
      },
      sequenceRoller([]),
      "nicole",
    );
    // 1 → 0 (emitted), then 0 can't drop further → the gate suppresses the second event.
    const reduced = events.filter((e) => e.type === "CHALLENGE_REDUCED").map((e) => e.payload.challenge);
    expect(reduced).toEqual([0]);
    expect(d.state.board.threats[0]?.challenge).toBe(0);
  });
});

describe("processIntent — Elbow Grease −4 Objective rating (#30)", () => {
  const guardedObjective: Objective = { ...objective, rating: 6, challenge: 2 };
  const unlockElbow: EventInput = { type: "ADVANCE_UNLOCKED", payload: { seat: "chuck", advanceId: "chuck-elbow-grease" }, actor: "chuck" };

  it("a crit on Chuck's (unlocked) Elbow Grease carries server-authoritative ratingDamage to the Objective", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [guardedObjective], threats: [threat] }); // obj1 rating 6, challenge 2
    d.seed([unlockElbow], "chuck");
    d.run({ kind: "start_turn", seat: "chuck", stat: "FIX" }, sequenceRoller([]), "chuck");
    const events = d.run(
      // The client's bogus ratingDamage (99) is IGNORED — the handler recomputes 4 from the descriptor.
      { kind: "allocate", allocations: [{ kind: "special", specialId: "chuck-elbow-grease", targetId: "obj1", units: 2, ratingDamage: 99 }] },
      sequenceRoller([]),
      "chuck",
    );
    expect(events.map((e) => e.type)).toEqual(["DIE_ALLOCATED"]); // no separate event — rides the allocation
    expect(events[0]?.payload).toMatchObject({ kind: "special", specialId: "chuck-elbow-grease", targetId: "obj1", ratingDamage: 4 });
    expect(d.state.board.objectives[0]?.rating).toBe(2); // 6 − 4 in full; Challenge 2 does NOT soak it
  });

  it("Elbow Grease that finishes an Objective clamps its rating to 0", () => {
    const weak: Objective = { ...guardedObjective, rating: 3 };
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [weak], threats: [threat] });
    d.seed([unlockElbow], "chuck");
    d.run({ kind: "start_turn", seat: "chuck", stat: "FIX" }, sequenceRoller([]), "chuck");
    d.run(
      { kind: "allocate", allocations: [{ kind: "special", specialId: "chuck-elbow-grease", targetId: "obj1", units: 2 }] },
      sequenceRoller([]),
      "chuck",
    );
    expect(d.state.board.objectives[0]?.rating).toBe(0);
  });

  it("no target → just the activation, no ratingDamage emitted", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [guardedObjective], threats: [threat] });
    d.seed([unlockElbow], "chuck");
    d.run({ kind: "start_turn", seat: "chuck", stat: "FIX" }, sequenceRoller([]), "chuck");
    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "special", specialId: "chuck-elbow-grease", units: 2 }] },
      sequenceRoller([]),
      "chuck",
    );
    expect(events[0]?.payload).not.toHaveProperty("ratingDamage");
    expect(d.state.board.objectives[0]?.rating).toBe(6);
  });

  it("a LOCKED Elbow Grease carries no ratingDamage (anti-fudge — the advance must be unlocked)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [guardedObjective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "chuck", stat: "FIX" }, sequenceRoller([]), "chuck"); // NOT unlocked
    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "special", specialId: "chuck-elbow-grease", targetId: "obj1", units: 2, ratingDamage: 99 }] },
      sequenceRoller([]),
      "chuck",
    );
    expect(events[0]?.payload).not.toHaveProperty("ratingDamage"); // descriptor not read from a locked advance
    expect(d.state.board.objectives[0]?.rating).toBe(6); // untouched
  });
});

describe("processIntent — Nightmare Regeneration clear-an-Injury (#31)", () => {
  const unlockRegen: EventInput = { type: "ADVANCE_UNLOCKED", payload: { seat: "astrid", advanceId: "astrid-nightmare-regeneration" }, actor: "astrid" };
  const markCat2Box1: EventInput = { type: "INJURY_MARKED", payload: { seat: "astrid", category: 2, box: 1 } };
  const markCat2Box2: EventInput = { type: "INJURY_MARKED", payload: { seat: "astrid", category: 2, box: 2 } };

  it("a crit on Astrid's (unlocked) Nightmare Regeneration clears the chosen wound, box resolved server-side", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.seed([unlockRegen, markCat2Box1], "astrid"); // injuries[2] = 1 ("Limping")
    d.run({ kind: "start_turn", seat: "astrid", stat: "BRAWL" }, sequenceRoller([]), "astrid");
    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "special", specialId: "astrid-nightmare-regeneration", injuryCategory: 2, units: 2 }] },
      sequenceRoller([]),
      "astrid",
    );
    expect(events.map((e) => e.type)).toEqual(["DIE_ALLOCATED", "HEALED"]);
    expect(events.find((e) => e.type === "HEALED")?.payload).toMatchObject({
      seat: "astrid",
      category: 2,
      box: 1, // the highest marked box, read off the live track (not trusted from the client)
      specialId: "astrid-nightmare-regeneration",
      specialName: "Nightmare Regeneration",
    });
    expect(d.state.characters.astrid.injuries).toEqual([0, 0, 0]);
  });

  it("two heal crits on one category peel off two boxes (compose via the running track)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.seed([unlockRegen, markCat2Box2], "astrid"); // injuries[2] = 2 (both boxes marked)
    d.run({ kind: "start_turn", seat: "astrid", stat: "BRAWL" }, sequenceRoller([]), "astrid");
    const events = d.run(
      {
        kind: "allocate",
        allocations: [
          { kind: "special", specialId: "astrid-nightmare-regeneration", injuryCategory: 2, units: 2 },
          { kind: "special", specialId: "astrid-nightmare-regeneration", injuryCategory: 2, units: 2 },
        ],
      },
      sequenceRoller([]),
      "astrid",
    );
    const boxes = events.filter((e) => e.type === "HEALED").map((e) => e.payload.box);
    expect(boxes).toEqual([2, 1]); // box 2 first, then the box below it
    expect(d.state.characters.astrid.injuries).toEqual([0, 0, 0]);
  });

  it("an unmarked category heals nothing — no phantom HEALED (anti-fudge)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.seed([unlockRegen], "astrid"); // no injuries marked
    d.run({ kind: "start_turn", seat: "astrid", stat: "BRAWL" }, sequenceRoller([]), "astrid");
    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "special", specialId: "astrid-nightmare-regeneration", injuryCategory: 0, units: 2 }] },
      sequenceRoller([]),
      "astrid",
    );
    expect(events.map((e) => e.type)).toEqual(["DIE_ALLOCATED"]); // nothing to clear
    expect(d.state.characters.astrid.injuries).toEqual([0, 0, 0]);
  });

  it("a LOCKED Nightmare Regeneration heals nothing (anti-fudge — the advance must be unlocked)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.seed([markCat2Box1], "astrid"); // injuries[2] = 1, but the advance is NOT unlocked
    d.run({ kind: "start_turn", seat: "astrid", stat: "BRAWL" }, sequenceRoller([]), "astrid");
    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "special", specialId: "astrid-nightmare-regeneration", injuryCategory: 2, units: 2 }] },
      sequenceRoller([]),
      "astrid",
    );
    expect(events.map((e) => e.type)).toEqual(["DIE_ALLOCATED"]); // descriptor not read from a locked advance
    expect(d.state.characters.astrid.injuries).toEqual([0, 0, 1]); // untouched
  });
});

describe("processIntent — Scavenger salvage-die throw (#32)", () => {
  // Reach the allocation window: frame, start Nicole's turn, land on the discard step with survivors.
  const reachAllocate = (seat: "nicole" | "iryna" = "nicole") => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat, stat: "SHOOT" }, sequenceRoller([]), seat);
    d.seed([{ type: "DICE_DISCARDED", payload: { playerSurvivors: [6, 5], gmSuccessCount: 0 } }], seat);
    return d;
  };

  it("the server rolls the salvage d6, restores the matching weapon, and parks the throw on the turn", () => {
    const d = reachAllocate();
    d.seed([{ type: "EQUIPMENT_USED", payload: { seat: "nicole", itemId: "nicole-panzerfaust" } }], "nicole"); // 1 → 0
    const events = d.run({ kind: "scavenge" }, sequenceRoller([5]), "nicole"); // face 5 → scavengerSlot 5 = Panzerfaust
    expect(events.map((e) => e.type)).toEqual(["SCAVENGER_ROLLED"]);
    expect(events.find((e) => e.type === "SCAVENGER_ROLLED")?.payload).toMatchObject({
      seat: "nicole",
      face: 5,
      itemId: "nicole-panzerfaust",
      itemName: "Panzerfaust",
      specialId: "nicole-scavenger",
      specialName: "Scavenger",
    });
    expect(d.state.characters.nicole.equipmentUses["nicole-panzerfaust"]).toBe(1); // salvaged back
    expect(d.state.currentTurn?.scavenge).toEqual({ face: 5, itemId: "nicole-panzerfaust", itemName: "Panzerfaust" });
  });

  it("a salvage on a full weapon never exceeds its max (clamped)", () => {
    const d = reachAllocate();
    const events = d.run({ kind: "scavenge" }, sequenceRoller([1]), "nicole"); // face 1 → M3, already 4/4
    expect(events.find((e) => e.type === "SCAVENGER_ROLLED")?.payload).toMatchObject({ itemId: "nicole-m3", itemName: "M3 submachine gun" });
    expect(d.state.characters.nicole.equipmentUses["nicole-m3"]).toBe(4); // unchanged, not 5
  });

  it("only one salvage die per turn", () => {
    const d = reachAllocate();
    d.run({ kind: "scavenge" }, sequenceRoller([2]), "nicole");
    expect(d.fail({ kind: "scavenge" }, "nicole").ok).toBe(false);
  });

  it("a character with no Scavenger SPECIAL can't scavenge", () => {
    const d = reachAllocate("iryna");
    expect(d.fail({ kind: "scavenge" }, "iryna").ok).toBe(false);
  });

  it("can't scavenge before the dice have been rolled (no survivors yet)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "nicole", stat: "SHOOT" }, sequenceRoller([]), "nicole");
    expect(d.fail({ kind: "scavenge" }, "nicole").ok).toBe(false);
  });
});

describe("processIntent — Feed on Fear +3 Blood on reduce-to-0 (#33)", () => {
  const unlockFeed: EventInput = { type: "ADVANCE_UNLOCKED", payload: { seat: "nicole", advanceId: "nicole-feed-on-fear" }, actor: "nicole" };
  const weak: Threat = { ...threat, rating: 2 };

  it("an eliminate that finishes a Threat pays Nicole 3 Blood at commit (no GM die through)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [weak] }); // thr1 rating 2
    d.seed([unlockFeed], "nicole");
    d.run({ kind: "start_turn", seat: "nicole", stat: "SHOOT" }, sequenceRoller([]), "nicole");
    d.run({ kind: "allocate", allocations: [{ kind: "eliminate", targetId: "thr1", units: 2 }] }, sequenceRoller([]), "nicole");
    expect(d.state.board.threats[0]?.rating).toBe(0);

    const events = d.run({ kind: "commit" }, sequenceRoller([]), "nicole");
    expect(events.map((e) => e.type)).toEqual(["BLOOD_CHANGED", "ALLOCATION_COMMITTED"]);
    expect(events.find((e) => e.type === "BLOOD_CHANGED")?.payload).toMatchObject({ seat: "nicole", delta: 3, reason: "Feed on Fear" });
    expect(d.state.characters.nicole.blood).toBe(3);
  });

  it("a LOCKED Feed on Fear pays nothing (anti-fudge — the advance must be unlocked)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [weak] });
    d.run({ kind: "start_turn", seat: "nicole", stat: "SHOOT" }, sequenceRoller([]), "nicole"); // advance NOT unlocked
    d.run({ kind: "allocate", allocations: [{ kind: "eliminate", targetId: "thr1", units: 2 }] }, sequenceRoller([]), "nicole");
    const events = d.run({ kind: "commit" }, sequenceRoller([]), "nicole");
    expect(events.map((e) => e.type)).toEqual(["ALLOCATION_COMMITTED"]);
    expect(d.state.characters.nicole.blood).toBe(0);
  });

  it("a Threat merely dented (not reduced to 0) pays nothing", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] }); // rating 4
    d.seed([unlockFeed], "nicole");
    d.run({ kind: "start_turn", seat: "nicole", stat: "SHOOT" }, sequenceRoller([]), "nicole");
    d.run({ kind: "allocate", allocations: [{ kind: "eliminate", targetId: "thr1", units: 2 }] }, sequenceRoller([]), "nicole"); // 4 → 2
    const events = d.run({ kind: "commit" }, sequenceRoller([]), "nicole");
    expect(events.map((e) => e.type)).toEqual(["ALLOCATION_COMMITTED"]);
    expect(d.state.characters.nicole.blood).toBe(0);
  });

  it("two Threats killed in one turn pay 3 each (per-Threat, deduped per Threat)", () => {
    const weakA: Threat = { ...threat, id: "thrA", rating: 2 };
    const weakB: Threat = { ...threat, id: "thrB", rating: 2 };
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [weakA, weakB] });
    d.seed([unlockFeed], "nicole");
    d.run({ kind: "start_turn", seat: "nicole", stat: "SHOOT" }, sequenceRoller([]), "nicole");
    d.run(
      {
        kind: "allocate",
        allocations: [
          { kind: "eliminate", targetId: "thrA", units: 1 },
          { kind: "eliminate", targetId: "thrA", units: 1 }, // two dice finish thrA — pays once
          { kind: "eliminate", targetId: "thrB", units: 2 },
        ],
      },
      sequenceRoller([]),
      "nicole",
    );
    const events = d.run({ kind: "commit" }, sequenceRoller([]), "nicole");
    expect(events.filter((e) => e.type === "BLOOD_CHANGED")).toHaveLength(2); // one per killed Threat, not per die
    expect(d.state.characters.nicole.blood).toBe(6);
  });

  it("still fires when a GM die gets through to the injury check (commit's injury branch)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [weak] });
    d.seed([unlockFeed], "nicole");
    d.run({ kind: "start_turn", seat: "nicole", stat: "SHOOT" }, sequenceRoller([]), "nicole");
    d.seed([{ type: "DICE_DISCARDED", payload: { gmSuccessCount: 2 } }], "nicole"); // gmDiceRemaining 2 → injury check opens
    d.run({ kind: "allocate", allocations: [{ kind: "eliminate", targetId: "thr1", units: 2 }] }, sequenceRoller([]), "nicole");
    const events = d.run({ kind: "commit" }, sequenceRoller([]), "nicole");
    expect(events.map((e) => e.type)).toEqual(["BLOOD_CHANGED", "INJURY_CHECK_OPENED"]);
    expect(d.state.characters.nicole.blood).toBe(3);
    expect(d.state.currentTurn?.phase).toBe("INJURY_CHECK"); // turn continues — Blood already banked
  });
});

describe("processIntent — Corrosive Fluids −2 Threat rating on Injury (#34)", () => {
  const unlock: EventInput = { type: "ADVANCE_UNLOCKED", payload: { seat: "chuck", advanceId: "chuck-corrosive-fluids" }, actor: "chuck" };

  /** Drive Chuck to a parked single-box Injury (d6=1 → category 0) against `threats`; each Threat's
   *  Attack is forced to 3 so a single in-play Threat keeps the GM pool a tidy 3 dice (1 gets through,
   *  so the injury check opens). Corrosive unlocked unless told otherwise. */
  function parkChuckInjury(threats: Threat[], { unlock: doUnlock = true } = {}) {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: threats.map((t) => ({ ...t, attack: 3 })) });
    if (doUnlock) d.seed([unlock], "chuck");
    d.run({ kind: "start_turn", seat: "chuck", stat: "BRAWL" }, sequenceRoller([]), "chuck");
    d.run({ kind: "roll", playerPoolDice: 2 }, sequenceRoller([5, 4]), "chuck"); // 2 player successes
    d.run({ kind: "roll_gm" }, sequenceRoller([6, 2, 2]), "gm"); // 3 GM dice, 1 success
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "chuck");
    d.run({ kind: "allocate", allocations: [{ kind: "advance", targetId: "obj1", units: 1 }, { kind: "advance", targetId: "obj1", units: 1 }] }, sequenceRoller([]), "chuck"); // no Defend → 1 GM left
    d.run({ kind: "commit" }, sequenceRoller([]), "chuck"); // opens INJURY_CHECK
    d.run({ kind: "roll_injury" }, sequenceRoller([1]), "chuck"); // 1 leftover → injury, d6=1 → category 0
    return d;
  }

  it("marking the wound corrodes the named Threat −2 (THREAT_RATING_REDUCED after INJURY_MARKED)", () => {
    const d = parkChuckInjury([threat]); // thr1 rating 4
    const events = d.run({ kind: "resolve_injury", corrosiveTargetId: "thr1" }, sequenceRoller([]), "chuck");
    expect(events.map((e) => e.type)).toEqual(["INJURY_MARKED", "THREAT_RATING_REDUCED", "ALLOCATION_COMMITTED"]);
    expect(events.find((e) => e.type === "THREAT_RATING_REDUCED")?.payload).toMatchObject({
      threatId: "thr1",
      threatName: "Nazi Squad",
      amount: 2,
      rating: 2,
      passiveId: "chuck-corrosive-fluids",
      passiveName: "Corrosive Fluids",
    });
    expect(d.state.board.threats[0]?.rating).toBe(2); // 4 − 2
    expect(d.state.characters.chuck.injuries[0]).toBe(1); // the wound still landed
  });

  it("corroding a Threat to 0 also drops its Attack to 0 (direct damage, RULES §3)", () => {
    const weak: Threat = { ...threat, rating: 2 };
    const d = parkChuckInjury([weak]);
    d.run({ kind: "resolve_injury", corrosiveTargetId: "thr1" }, sequenceRoller([]), "chuck");
    expect(d.state.board.threats[0]).toMatchObject({ rating: 0, attack: 0 });
  });

  it("a LOCKED Corrosive Fluids corrodes nothing (anti-fudge — the advance must be unlocked)", () => {
    const d = parkChuckInjury([threat], { unlock: false });
    const events = d.run({ kind: "resolve_injury", corrosiveTargetId: "thr1" }, sequenceRoller([]), "chuck");
    expect(events.map((e) => e.type)).toEqual(["INJURY_MARKED", "ALLOCATION_COMMITTED"]);
    expect(d.state.board.threats[0]?.rating).toBe(4); // untouched
  });

  it("no target named → just the wound, no corrosion", () => {
    const d = parkChuckInjury([threat]);
    const events = d.run({ kind: "resolve_injury" }, sequenceRoller([]), "chuck");
    expect(events.map((e) => e.type)).toEqual(["INJURY_MARKED", "ALLOCATION_COMMITTED"]);
    expect(d.state.board.threats[0]?.rating).toBe(4);
  });

  it("a shrugged-off wound (ignore) marks nothing and corrodes nothing", () => {
    const d = parkChuckInjury([threat]);
    d.run({ kind: "use_equipment", seat: "chuck", itemId: "chuck-cowboy-hat" }, sequenceRoller([]), "chuck");
    const events = d.run({ kind: "resolve_injury", ignore: true, corrosiveTargetId: "thr1" }, sequenceRoller([]), "chuck");
    expect(events.map((e) => e.type)).toEqual(["ALLOCATION_COMMITTED"]); // no INJURY_MARKED, no corrosion
    expect(d.state.board.threats[0]?.rating).toBe(4);
  });

  it("a not-in-play (staged) target corrodes nothing", () => {
    const staged: Threat = { ...threat, id: "staged", active: false };
    const d = parkChuckInjury([threat, staged]); // only thr1 is in play / feeds the GM pool
    const events = d.run({ kind: "resolve_injury", corrosiveTargetId: "staged" }, sequenceRoller([]), "chuck");
    expect(events.map((e) => e.type)).toEqual(["INJURY_MARKED", "ALLOCATION_COMMITTED"]);
    expect(d.state.board.threats.find((t) => t.id === "staged")?.rating).toBe(4);
  });

  it("corrosion also rides the Rending Claws escalation (still an Injury marked)", () => {
    const beast: Threat = { ...werhund(), id: "werhund1", rating: 6 }; // the lone in-play Threat → pool stays 3
    const d = parkChuckInjury([beast]); // a Werhund in play → the wound can be rended, and it's the corrode target
    const events = d.run({ kind: "resolve_injury", rending: true, corrosiveTargetId: "werhund1" }, sequenceRoller([]), "chuck");
    expect(events.map((e) => e.type)).toEqual(["INJURY_MARKED", "THREAT_RATING_REDUCED", "ALLOCATION_COMMITTED"]);
    expect(d.state.characters.chuck.injuries[0]).toBe(2); // whole category filled
    expect(d.state.board.threats.find((t) => t.id === "werhund1")?.rating).toBe(4); // 6 − 2
  });
});

describe("processIntent — Tethered Phantom / Hellish Screech −1 Challenge from the sheet (#35)", () => {
  const guardedThreat: Threat = { ...threat, challenge: 2 };
  const guardedObjective: Objective = { ...objective, challenge: 2 };
  const give = (seat: "astrid" | "flint", n: number): EventInput => ({ type: "BLOOD_CHANGED", payload: { seat, delta: n }, actor: seat });
  const unlock = (seat: "astrid" | "flint", advanceId: string): EventInput => ({ type: "ADVANCE_UNLOCKED", payload: { seat, advanceId }, actor: seat });

  it("Astrid's (unlocked) Tethered Phantom drops a Threat's Challenge by 1, round-scoped, for 1 Blood", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [guardedThreat] });
    d.seed([unlock("astrid", "astrid-tethered-phantom"), give("astrid", 3)], "astrid");
    const events = d.run({ kind: "use_power", seat: "astrid", powerId: "astrid-tethered-phantom", targetId: "thr1" }, sequenceRoller([]), "astrid");
    expect(events.map((e) => e.type)).toEqual(["CHALLENGE_REDUCED", "BLOOD_CHANGED"]);
    expect(events.find((e) => e.type === "CHALLENGE_REDUCED")?.payload).toMatchObject({
      targetId: "thr1",
      targetName: "Nazi Squad",
      targetKind: "threat",
      amount: 1,
      challenge: 1,
      powerId: "astrid-tethered-phantom",
      powerName: "Tethered Phantom",
      temporary: true,
    });
    expect(d.state.board.threats[0]?.challenge).toBe(1);
    expect(d.state.board.threats[0]?.tempChallengeReduction).toBe(1); // banked for the round-end restore
    expect(d.state.characters.astrid.blood).toBe(2); // 3 − 1
  });

  it("Tethered Phantom can also aim at an Objective (scope objective_or_threat)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [guardedObjective], threats: [threat] });
    d.seed([unlock("astrid", "astrid-tethered-phantom"), give("astrid", 3)], "astrid");
    const events = d.run({ kind: "use_power", seat: "astrid", powerId: "astrid-tethered-phantom", targetId: "obj1" }, sequenceRoller([]), "astrid");
    expect(events.find((e) => e.type === "CHALLENGE_REDUCED")?.payload).toMatchObject({ targetId: "obj1", targetKind: "objective", challenge: 1, temporary: true });
    expect(d.state.board.objectives[0]?.challenge).toBe(1);
    expect(d.state.board.objectives[0]?.tempChallengeReduction).toBe(1);
  });

  it("Flint's (unlocked) Hellish Screech drops a Threat's Challenge permanently (no temporary), for 2 Blood", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [guardedThreat] });
    d.seed([unlock("flint", "flint-hellish-screech"), give("flint", 3)], "flint");
    const events = d.run({ kind: "use_power", seat: "flint", powerId: "flint-hellish-screech", targetId: "thr1" }, sequenceRoller([]), "flint");
    expect(events.map((e) => e.type)).toEqual(["CHALLENGE_REDUCED", "BLOOD_CHANGED"]);
    const reduced = events.find((e) => e.type === "CHALLENGE_REDUCED")?.payload;
    expect(reduced).toMatchObject({ targetKind: "threat", challenge: 1, powerId: "flint-hellish-screech", powerName: "Hellish Screech" });
    expect((reduced as { temporary?: boolean }).temporary).toBeUndefined(); // permanent — no round-end restore
    expect(d.state.board.threats[0]?.challenge).toBe(1);
    expect(d.state.board.threats[0]?.tempChallengeReduction).toBeUndefined();
    expect(d.state.characters.flint.blood).toBe(1); // 3 − 2
  });

  it("Hellish Screech is Threat-only — aiming it at an Objective is rejected (scope)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [guardedObjective], threats: [threat] });
    d.seed([unlock("flint", "flint-hellish-screech"), give("flint", 3)], "flint");
    const r = d.fail({ kind: "use_power", seat: "flint", powerId: "flint-hellish-screech", targetId: "obj1" }, "flint");
    expect(r.ok).toBe(false);
  });

  it("a LOCKED advance can't fire (anti-fudge) and spends no Blood", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [guardedThreat] });
    d.seed([give("astrid", 3)], "astrid"); // Blood, but the advance is NOT unlocked
    const r = d.fail({ kind: "use_power", seat: "astrid", powerId: "astrid-tethered-phantom", targetId: "thr1" }, "astrid");
    expect(r.ok).toBe(false);
    expect(d.state.board.threats[0]?.challenge).toBe(2); // untouched
    expect(d.state.characters.astrid.blood).toBe(3); // no Blood spent
  });

  it("not enough Blood → rejected", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [guardedThreat] });
    d.seed([unlock("flint", "flint-hellish-screech"), give("flint", 1)], "flint"); // needs 2
    const r = d.fail({ kind: "use_power", seat: "flint", powerId: "flint-hellish-screech", targetId: "thr1" }, "flint");
    expect(r.ok).toBe(false);
  });

  it("honours the Werhund's 'Unlowerable Challenge' (#25): nothing happens, no Blood spent", () => {
    const dog = { ...werhund(), id: "thr1" } as Threat; // challenge 1, unlowerableChallenge true
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [dog] });
    d.seed([unlock("flint", "flint-hellish-screech"), give("flint", 3)], "flint");
    const r = d.fail({ kind: "use_power", seat: "flint", powerId: "flint-hellish-screech", targetId: "thr1" }, "flint");
    expect(r.ok).toBe(false);
    expect(d.state.board.threats[0]?.challenge).toBe(1); // the lock held
    expect(d.state.characters.flint.blood).toBe(3); // no Blood spent on a no-op
  });

  it("a target with no Challenge left to lower is rejected (no phantom drop)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [{ ...threat, challenge: 0 }] });
    d.seed([unlock("astrid", "astrid-tethered-phantom"), give("astrid", 3)], "astrid");
    const r = d.fail({ kind: "use_power", seat: "astrid", powerId: "astrid-tethered-phantom", targetId: "thr1" }, "astrid");
    expect(r.ok).toBe(false);
    expect(d.state.characters.astrid.blood).toBe(3);
  });

  it("Tethered Phantom's drop is handed back at end of round (survives reinforcement)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [guardedThreat] }); // challenge 2, attack 3
    d.seed([unlock("astrid", "astrid-tethered-phantom"), give("astrid", 3)], "astrid");
    d.run({ kind: "use_power", seat: "astrid", powerId: "astrid-tethered-phantom", targetId: "thr1" }, sequenceRoller([]), "astrid");
    expect(d.state.board.threats[0]?.challenge).toBe(1); // dropped this round

    // End of round: the Threat reinforces (Attack +1) but its temp Challenge cut is restored.
    d.run({ kind: "end_round" }, sequenceRoller([1]));
    expect(d.state.board.threats[0]?.challenge).toBe(2); // handed back
    expect(d.state.board.threats[0]?.tempChallengeReduction).toBeUndefined();
    expect(d.state.board.threats[0]?.attack).toBe(4); // still reinforced (+1) — restore didn't undo that
  });
});

describe("processIntent — cross-turn stances (Iryna's #36 actives)", () => {
  const guardedThreat: Threat = { ...threat, rating: 4, challenge: 2 };
  const give = (n: number): EventInput => ({ type: "BLOOD_CHANGED", payload: { seat: "iryna", delta: n }, actor: "iryna" });
  const unlock = (advanceId: string): EventInput => ({ type: "ADVANCE_UNLOCKED", payload: { seat: "iryna", advanceId }, actor: "iryna" });

  // ── Hell's Ravenous Fire — ignore Threat Challenge on the next action ──────
  it("arming Hell's Ravenous Fire parks the stance and spends 1 Blood", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [guardedThreat] });
    d.seed([unlock("iryna-hells-fire"), give(3)], "iryna");
    const events = d.run({ kind: "set_stance", seat: "iryna", powerId: "iryna-hells-fire" }, sequenceRoller([]), "iryna");
    expect(events.map((e) => e.type)).toEqual(["STANCE_SET", "BLOOD_CHANGED"]);
    expect(events[0]?.payload).toMatchObject({ kind: "ignore-threat-challenge", powerId: "iryna-hells-fire", powerName: "Hell's Ravenous Fire" });
    expect(d.state.characters.iryna.stances).toEqual([{ kind: "ignore-threat-challenge", powerId: "iryna-hells-fire", powerName: "Hell's Ravenous Fire" }]);
    expect(d.state.characters.iryna.blood).toBe(2); // 3 − 1
  });

  it("Hell's Ravenous Fire is consumed at the NEXT turn and that action ignores Threat Challenge", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [guardedThreat] }); // thr1 rating 4, challenge 2
    d.seed([unlock("iryna-hells-fire"), give(3)], "iryna");
    d.run({ kind: "set_stance", seat: "iryna", powerId: "iryna-hells-fire" }, sequenceRoller([]), "iryna");

    const started = d.run({ kind: "start_turn", seat: "iryna", stat: "BRAWL" }, sequenceRoller([]), "iryna");
    expect(started[0]?.payload).toMatchObject({ ignoreThreatChallenge: { powerId: "iryna-hells-fire", powerName: "Hell's Ravenous Fire" } });
    expect(d.state.currentTurn?.ignoreThreatChallenge).toBe(true);
    expect(d.state.characters.iryna.stances).toEqual([]); // consumed off the sheet

    // 2 eliminate units would normally be wholly soaked by Challenge 2 (rating unchanged); ignored → −2.
    d.run({ kind: "allocate", allocations: [{ kind: "eliminate", targetId: "thr1", units: 2 }] }, sequenceRoller([]), "iryna");
    expect(d.state.board.threats[0]?.rating).toBe(2);
  });

  it("a LOCKED Hell's Ravenous Fire can't be armed (anti-fudge) and spends no Blood", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [guardedThreat] });
    d.seed([give(3)], "iryna"); // Blood, but the advance is NOT unlocked
    const r = d.fail({ kind: "set_stance", seat: "iryna", powerId: "iryna-hells-fire" }, "iryna");
    expect(r.ok).toBe(false);
    expect(d.state.characters.iryna.blood).toBe(3);
    expect(d.state.characters.iryna.stances ?? []).toEqual([]);
  });

  it("re-arming a stance already held is rejected (no double Blood charge)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [guardedThreat] });
    d.seed([unlock("iryna-hells-fire"), give(3)], "iryna");
    d.run({ kind: "set_stance", seat: "iryna", powerId: "iryna-hells-fire" }, sequenceRoller([]), "iryna");
    const r = d.fail({ kind: "set_stance", seat: "iryna", powerId: "iryna-hells-fire" }, "iryna");
    expect(r.ok).toBe(false);
    expect(d.state.characters.iryna.blood).toBe(2); // charged once only
  });

  it("not enough Blood → rejected (Mantle needs 2)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [guardedThreat] });
    d.seed([unlock("iryna-mantle"), give(1)], "iryna"); // Mantle costs 2
    const r = d.fail({ kind: "set_stance", seat: "iryna", powerId: "iryna-mantle", objectiveId: "obj1" }, "iryna");
    expect(r.ok).toBe(false);
  });

  // ── Enervation of the Soul — granted SPECIAL: 4 to an Übermensch ───────────
  it("Enervation grants a next-roll SPECIAL inflicting 4 to an Übermensch (folds ratingDamage, bypasses Challenge)", () => {
    const uber = { ...stahlsoldat(), id: "uber" }; // rating 6, challenge 2, ubermensch
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [uber] });
    d.seed([unlock("iryna-enervation"), give(3)], "iryna");
    d.run({ kind: "set_stance", seat: "iryna", powerId: "iryna-enervation" }, sequenceRoller([]), "iryna");

    const started = d.run({ kind: "start_turn", seat: "iryna", stat: "TERRIFY" }, sequenceRoller([]), "iryna");
    expect(started[0]?.payload).toMatchObject({ enervation: { powerId: "iryna-enervation", powerName: "Enervation of the Soul", damage: 4 } });
    expect(d.state.currentTurn?.enervation).toMatchObject({ damage: 4 });
    expect(d.state.characters.iryna.stances).toEqual([]); // consumed

    const events = d.run(
      // client ratingDamage is ignored — recomputed from the turn's grant; the Übermensch's Challenge 2 doesn't soak it.
      { kind: "allocate", allocations: [{ kind: "special", specialId: "iryna-enervation", targetId: "uber", units: 2, ratingDamage: 99 }] },
      sequenceRoller([]),
      "iryna",
    );
    expect(events[0]?.payload).toMatchObject({ kind: "special", specialId: "iryna-enervation", targetId: "uber", ratingDamage: 4 });
    expect(d.state.board.threats[0]?.rating).toBe(2); // 6 − 4 in full
  });

  // ── Mantle of the Fell Beast — stat transform + item lock until the Objective completes ──
  it("Mantle binds to an Objective, costs 2 Blood, and transforms stats via activeMantle", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] }); // obj1 "Take cover", rating 6
    d.seed([unlock("iryna-mantle"), give(3)], "iryna");
    const events = d.run({ kind: "set_stance", seat: "iryna", powerId: "iryna-mantle", objectiveId: "obj1" }, sequenceRoller([]), "iryna");
    expect(events[0]?.payload).toMatchObject({ kind: "mantle", objectiveId: "obj1", objectiveName: "Take cover", highValue: 4, lowValue: 1, blocksItems: true });
    expect(d.state.characters.iryna.blood).toBe(1); // 3 − 2
    const m = activeMantle(d.state.characters.iryna, d.state.board.objectives);
    expect(m?.objectiveId).toBe("obj1");
    expect(effectiveStats(CHARACTERS_BY_ID.iryna!.stats, m)).toMatchObject({ BRAWL: 4, TERRIFY: 4, SHOOT: 1, CON: 1 });
  });

  it("Mantle requires a real in-play Objective to bind to", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.seed([unlock("iryna-mantle"), give(3)], "iryna");
    const r = d.fail({ kind: "set_stance", seat: "iryna", powerId: "iryna-mantle", objectiveId: "nope" }, "iryna");
    expect(r.ok).toBe(false);
    expect(d.state.characters.iryna.blood).toBe(3); // nothing spent
  });

  it("Mantle ends when its Objective completes (derived) and is then re-castable on a new Objective", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [{ ...objective, rating: 2 }], threats: [threat] });
    d.seed([unlock("iryna-mantle"), give(5)], "iryna");
    d.run({ kind: "set_stance", seat: "iryna", powerId: "iryna-mantle", objectiveId: "obj1" }, sequenceRoller([]), "iryna");
    expect(activeMantle(d.state.characters.iryna, d.state.board.objectives)).toBeTruthy();

    d.run({ kind: "complete_objective", id: "obj1" });
    expect(activeMantle(d.state.characters.iryna, d.state.board.objectives)).toBeUndefined(); // derived off rating 0

    // The spent Mantle no longer blocks re-arming on a fresh Objective (the re-arm guard reads activeMantle).
    d.run({ kind: "add_objective", objective: { id: "obj2", name: "Reach the vault", kind: "objective", rating: 4 } });
    d.run({ kind: "set_stance", seat: "iryna", powerId: "iryna-mantle", objectiveId: "obj2" }, sequenceRoller([]), "iryna");
    expect(activeMantle(d.state.characters.iryna, d.state.board.objectives)?.objectiveId).toBe("obj2");
  });
});

describe("processIntent — Last Stand (RULES §5)", () => {
  const allSixMarked = ([0, 1, 2] as const).flatMap((category) =>
    ([1, 2] as const).map((box) => ({ type: "INJURY_MARKED" as const, payload: { seat: "iryna" as const, category, box } })),
  );

  it("a 7th injury overflows to death → opens a Last Stand instead of retiring", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.seed(allSixMarked); // all 6 boxes already marked, but not yet dead
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    // player 5,4 (2 successes); GM 6,2,2 (1 success)
    d.run({ kind: "roll", playerPoolDice: 2 }, sequenceRoller([5, 4]), "iryna");
    d.run({ kind: "roll_gm" }, sequenceRoller([6, 2, 2]), "gm");
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "iryna");
    d.run({ kind: "allocate", allocations: [{ kind: "advance", targetId: "obj1", units: 1 }] }, sequenceRoller([]), "iryna"); // no Defend → 1 GM die left
    d.run({ kind: "commit" }, sequenceRoller([]), "iryna"); // opens the window (no roll yet)
    const parked = d.run({ kind: "roll_injury" }, sequenceRoller([3]), "iryna"); // 1 leftover → injury → nowhere free → death
    expect(parked.map((e) => e.type)).toEqual(["INJURY_PENDING"]);
    expect(d.state.currentTurn?.pendingInjury?.outcome.kind).toBe("death");

    const ev = d.run({ kind: "resolve_injury" }, sequenceRoller([]), "iryna");
    expect(ev.map((e) => e.type)).toContain("DEATH_LAST_STAND");
    expect(ev.map((e) => e.type)).not.toContain("ALLOCATION_COMMITTED"); // not retired yet
    expect(d.state.characters.iryna.dead).toBe(false);
    expect(d.state.currentTurn?.lastStand).toBe(true);
    expect(d.state.characters.iryna.injuries).toEqual([2, 2, 2]);
  });

  it("rolls 8d6 (every die counts), then committing hits the board and retires the vampire", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.seed([{ type: "DEATH_LAST_STAND", payload: { seat: "iryna" } }]); // open a Last Stand directly
    expect(d.state.currentTurn?.lastStand).toBe(true);

    const rolled = d.run({ kind: "last_stand_roll" }, sequenceRoller([1, 2, 3, 4, 5, 6, 6, 4]), "iryna");
    expect(rolled.find((e) => e.type === "LAST_STAND_ROLLED")?.payload).toMatchObject({ seat: "iryna", dice: [1, 2, 3, 4, 5, 6, 6, 4] });
    expect(d.state.currentTurn?.survivors).toHaveLength(8); // no discard — all 8 are usable

    const ended = d.run(
      {
        kind: "last_stand_commit",
        allocations: [
          { kind: "advance", targetId: "obj1", units: 2 }, // a crit
          { kind: "eliminate", targetId: "thr1", units: 1 },
        ],
      },
      sequenceRoller([]),
      "iryna",
    );

    expect(ended.map((e) => e.type)).toEqual(["DIE_ALLOCATED", "DIE_ALLOCATED", "LAST_STAND_ENDED"]);
    expect(d.state.characters.iryna.dead).toBe(true);
    expect(d.state.currentTurn).toBeNull();
    expect(d.state.board.objectives[0]!.rating).toBe(4); // 6 − 2
    expect(d.state.board.threats[0]!.rating).toBe(3); // 4 − 1
  });

  it("rejects rolling a Last Stand when none is open", () => {
    const d = makeDriver();
    expect(d.fail({ kind: "last_stand_roll" }, "iryna").ok).toBe(false);
  });
});

describe("processIntent — mid-allocation bonus dice (RULES §4)", () => {
  /** Drive a turn into the ALLOCATE phase (survivors present) for `seat`. */
  function intoAllocation(seat: "iryna" = "iryna") {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat, stat: "SHOOT" }, sequenceRoller([]), seat);
    d.run({ kind: "roll", playerPoolDice: 2 }, sequenceRoller([5, 2]), seat); // 1 survivor (5)
    d.run({ kind: "roll_gm" }, sequenceRoller([6, 2, 2]), "gm"); // GM 1 succ
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), seat);
    return d;
  }

  it("rolls more dice into the tray and appends the survivors", () => {
    const d = intoAllocation();
    expect(d.state.currentTurn?.survivors).toHaveLength(1);

    // Add 2 bonus dice that roll 6 (crit) and 2 (discarded) → +1 survivor (the crit).
    const ev = d.run({ kind: "add_bonus_dice", count: 2, label: "flanking" }, sequenceRoller([6, 2]), "iryna");
    expect(ev.map((e) => e.type)).toEqual(["BONUS_DICE_ROLLED"]);

    const surv = d.state.currentTurn?.survivors ?? [];
    expect(surv).toHaveLength(2); // 1 original + 1 bonus crit (the 2 was discarded)
    expect(surv[1]).toMatchObject({ face: 6, kind: "crit", units: 2 });
    expect(d.state.currentTurn?.playerPool?.sources.at(-1)).toMatchObject({ label: "+flanking", dice: 2 });
  });

  it("rejects bonus dice outside the allocation phase", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    // No discard yet → no survivors → not in allocation.
    expect(d.fail({ kind: "add_bonus_dice", count: 1 }, "iryna").ok).toBe(false);
  });

  it("respects an in-play Rust-Witch's raised discard threshold", () => {
    const rustWitch: Threat = { id: "rw", name: "Rust-Witch", kind: "threat", rating: 3, attack: 2, startingAttack: 2, reinforces: false, restoresAtZero: false, discardThreshold: 4 };
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [rustWitch] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    d.run({ kind: "roll", playerPoolDice: 1 }, sequenceRoller([6]), "iryna"); // crit survives
    d.run({ kind: "roll_gm" }, sequenceRoller([2, 2]), "gm"); // GM 0 succ (pool 2)
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "iryna");

    // Threshold 4 → a rolled 4 is discarded, only 5–6 survive.
    d.run({ kind: "add_bonus_dice", count: 2, label: "x" }, sequenceRoller([4, 5]), "iryna");
    const surv = d.state.currentTurn?.survivors ?? [];
    expect(surv).toHaveLength(2); // original crit + the 5 (the 4 was discarded at threshold 4)
    expect(surv[1]).toMatchObject({ face: 5, kind: "success" });
  });
});

describe("processIntent — INJURY_CHECK window + reactive gear (RULES §4/§5)", () => {
  /** Drive a turn up to a parked single-box Injury for `seat` (d6=1 → category 0). */
  function parkAnInjury(seat: "astrid" | "chuck") {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat, stat: "BRAWL" }, sequenceRoller([]), seat);
    d.run({ kind: "roll", playerPoolDice: 2 }, sequenceRoller([5, 4]), seat); // player 2 succ
    d.run({ kind: "roll_gm" }, sequenceRoller([6, 2, 2]), "gm"); // GM (3 dice) 1 succ
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), seat);
    d.run({ kind: "allocate", allocations: [{ kind: "advance", targetId: "obj1", units: 1 }, { kind: "advance", targetId: "obj1", units: 1 }] }, sequenceRoller([]), seat); // no Defend → 1 GM left
    d.run({ kind: "commit" }, sequenceRoller([]), seat); // opens the INJURY_CHECK window
    d.run({ kind: "roll_injury" }, sequenceRoller([1]), seat); // 1 leftover → injury, d6=1 → category 0
    return d;
  }

  it("resolve_injury marks the rolled box and closes the turn", () => {
    const d = parkAnInjury("astrid");
    expect(d.state.characters.astrid.injuries).toEqual([0, 0, 0]); // parked, not yet marked
    expect(d.state.currentTurn?.pendingInjury).toMatchObject({ face: 1, outcome: { kind: "injury", category: 0, box: 1 } });

    const resolved = d.run({ kind: "resolve_injury" }, sequenceRoller([]), "astrid");
    expect(resolved.map((e) => e.type)).toEqual(["INJURY_MARKED", "ALLOCATION_COMMITTED"]);
    expect(d.state.characters.astrid.injuries[0]).toBe(1);
    expect(d.state.currentTurn).toBeNull();
    expect(d.state.actedThisRound).toEqual(["astrid"]);
  });

  it("Chuck shrugs off the injury with the cowboy hat (use + ignore)", () => {
    const d = parkAnInjury("chuck");
    // Burn the hat, then ignore the pending injury.
    d.run({ kind: "use_equipment", seat: "chuck", itemId: "chuck-cowboy-hat" }, sequenceRoller([]), "chuck");
    const resolved = d.run({ kind: "resolve_injury", ignore: true }, sequenceRoller([]), "chuck");

    expect(resolved.map((e) => e.type)).toEqual(["ALLOCATION_COMMITTED"]); // no INJURY_MARKED
    expect(d.state.characters.chuck.injuries).toEqual([0, 0, 0]); // shrugged off
    expect(d.state.characters.chuck.equipmentUses["chuck-cowboy-hat"]).toBe(0); // hat destroyed
    expect(d.state.currentTurn).toBeNull();
    expect(d.state.actedThisRound).toEqual(["chuck"]); // still counts as the turn
  });

  it("rejects resolve_injury when nothing is pending", () => {
    const d = makeDriver();
    expect(d.fail({ kind: "resolve_injury" }).ok).toBe(false);
  });

  it("rejects roll_injury outside an open injury window, and a second throw once parked", () => {
    const d = makeDriver();
    expect(d.fail({ kind: "roll_injury" }).ok).toBe(false); // no window open
    const parked = parkAnInjury("astrid");
    expect(parked.fail({ kind: "roll_injury" }).ok).toBe(false); // already thrown
  });

  it("using Iryna's cigarettes regains 2 Blood automatically (and only while a use remains)", () => {
    const d = makeDriver();
    expect(d.state.characters.iryna.blood).toBe(0);

    // Cigarettes have 3 uses; each marked use mints 2 Blood.
    const ev = d.run({ kind: "use_equipment", seat: "iryna", itemId: "iryna-cigarettes" }, sequenceRoller([]), "iryna");
    expect(ev.map((e) => e.type)).toEqual(["EQUIPMENT_USED", "BLOOD_CHANGED"]);
    expect(d.state.characters.iryna.blood).toBe(2);
    expect(d.state.characters.iryna.equipmentUses["iryna-cigarettes"]).toBe(2);

    // Burn the other two uses (6 Blood total, all uses spent).
    d.run({ kind: "use_equipment", seat: "iryna", itemId: "iryna-cigarettes" }, sequenceRoller([]), "iryna");
    d.run({ kind: "use_equipment", seat: "iryna", itemId: "iryna-cigarettes" }, sequenceRoller([]), "iryna");
    expect(d.state.characters.iryna.blood).toBe(6);
    expect(d.state.characters.iryna.equipmentUses["iryna-cigarettes"]).toBe(0);

    // Depleted now → using again no longer mints Blood.
    const ev2 = d.run({ kind: "use_equipment", seat: "iryna", itemId: "iryna-cigarettes" }, sequenceRoller([]), "iryna");
    expect(ev2.map((e) => e.type)).toEqual(["EQUIPMENT_USED"]);
    expect(d.state.characters.iryna.blood).toBe(6);
  });

  it("a weapon use grants no Blood (only reactive items do)", () => {
    const d = makeDriver();
    const ev = d.run({ kind: "use_equipment", seat: "iryna", itemId: "iryna-sabre" }, sequenceRoller([]), "iryna");
    expect(ev.map((e) => e.type)).toEqual(["EQUIPMENT_USED"]);
    expect(d.state.characters.iryna.blood).toBe(0);
  });

  it("restore_equipment hands a spent use back, and is a no-op on a full item", () => {
    const d = makeDriver();
    d.run({ kind: "use_equipment", seat: "iryna", itemId: "iryna-sabre" }, sequenceRoller([]), "iryna");
    expect(d.state.characters.iryna.equipmentUses["iryna-sabre"]).toBe(4); // 5 → 4

    const ev = d.run({ kind: "restore_equipment", seat: "iryna", itemId: "iryna-sabre" }, sequenceRoller([]), "iryna");
    expect(ev.map((e) => e.type)).toEqual(["EQUIPMENT_RESTORED"]);
    expect(d.state.characters.iryna.equipmentUses["iryna-sabre"]).toBe(5); // back to full

    // Already full → no event, no phantom use.
    const ev2 = d.run({ kind: "restore_equipment", seat: "iryna", itemId: "iryna-sabre" }, sequenceRoller([]), "iryna");
    expect(ev2).toEqual([]);
    expect(d.state.characters.iryna.equipmentUses["iryna-sabre"]).toBe(5);
  });

  it("restoring a reactive item returns the Blood it minted (no farming loop)", () => {
    const d = makeDriver();
    d.run({ kind: "use_equipment", seat: "iryna", itemId: "iryna-cigarettes" }, sequenceRoller([]), "iryna");
    expect(d.state.characters.iryna.blood).toBe(2);

    const ev = d.run({ kind: "restore_equipment", seat: "iryna", itemId: "iryna-cigarettes" }, sequenceRoller([]), "iryna");
    expect(ev.map((e) => e.type)).toEqual(["EQUIPMENT_RESTORED", "BLOOD_CHANGED"]);
    expect(d.state.characters.iryna.blood).toBe(0);
    expect(d.state.characters.iryna.equipmentUses["iryna-cigarettes"]).toBe(3);
  });
});

describe("processIntent — Werhund 'Rending Claws' (rulebook p64, issue #24)", () => {
  /** Drive a turn to a parked single-box Injury for Astrid against the given threats (d6=1 →
   *  category 0). The threat's Attack is forced to 3 so the GM pool stays a tidy 3 dice. */
  function parkAnInjuryVs(threats: Threat[]) {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: threats.map((t) => ({ ...t, attack: 3 })) });
    d.run({ kind: "start_turn", seat: "astrid", stat: "BRAWL" }, sequenceRoller([]), "astrid");
    d.run({ kind: "roll", playerPoolDice: 2 }, sequenceRoller([5, 4]), "astrid"); // 2 player successes
    d.run({ kind: "roll_gm" }, sequenceRoller([6, 2, 2]), "gm"); // 3 GM dice → 1 success
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "astrid");
    d.run({ kind: "allocate", allocations: [{ kind: "advance", targetId: "obj1", units: 1 }, { kind: "advance", targetId: "obj1", units: 1 }] }, sequenceRoller([]), "astrid"); // no Defend → 1 GM left
    d.run({ kind: "commit" }, sequenceRoller([]), "astrid"); // opens the INJURY_CHECK window
    d.run({ kind: "roll_injury" }, sequenceRoller([1]), "astrid"); // 1 leftover → injury, d6=1 → category 0
    return d;
  }

  it("rends a normal Injury to fill the whole category (box 2 + penalty) when a Werhund is in play", () => {
    const d = parkAnInjuryVs([{ ...werhund(), id: "werhund1" }]);
    expect(d.state.currentTurn?.pendingInjury).toMatchObject({ outcome: { kind: "injury", category: 0, box: 1 } });

    const resolved = d.run({ kind: "resolve_injury", rending: true }, sequenceRoller([]), "astrid");
    const marked = resolved.find((e) => e.type === "INJURY_MARKED");
    expect(marked?.payload).toMatchObject({ seat: "astrid", category: 0, box: 2, rending: true });
    expect((marked?.payload as { penalty?: string }).penalty).toBeTruthy(); // 2nd-box penalty fires
    expect(d.state.characters.astrid.injuries).toEqual([2, 0, 0]); // the WHOLE category filled
    expect(d.state.characters.astrid.downed).toBe(false); // still an Injury, NOT a Downed
    expect(d.state.currentTurn).toBeNull();
  });

  it("ignores the rending flag when no Werhund is in play — a normal one-box Injury (gating)", () => {
    const d = parkAnInjuryVs([{ ...threat, id: "thr1" }]); // plain Nazi Squad, no rending-claws rule
    const resolved = d.run({ kind: "resolve_injury", rending: true }, sequenceRoller([]), "astrid");
    const marked = resolved.find((e) => e.type === "INJURY_MARKED");
    expect(marked?.payload).toMatchObject({ category: 0, box: 1 });
    expect((marked?.payload as { rending?: boolean }).rending).toBeUndefined();
    expect(d.state.characters.astrid.injuries).toEqual([1, 0, 0]); // only one box
  });

  it("a plain resolve (no flag) is unchanged even with a Werhund in play — opt-in only", () => {
    const d = parkAnInjuryVs([{ ...werhund(), id: "werhund1" }]);
    d.run({ kind: "resolve_injury" }, sequenceRoller([]), "astrid"); // no rending flag
    expect(d.state.characters.astrid.injuries).toEqual([1, 0, 0]); // one box, not rent
  });
});

describe("processIntent — pre-discard passives", () => {
  it("Corpse Eater (Chuck) grants +1 Blood on a rolled 1", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "chuck", stat: "SHOOT" }, sequenceRoller([]), "chuck");
    d.run({ kind: "roll", playerPoolDice: 3 }, sequenceRoller([1, 5, 4]), "chuck");
    d.run({ kind: "roll_gm" }, sequenceRoller([4, 4, 4]), "gm");
    const events = d.run({ kind: "resolve_discard" }, sequenceRoller([]), "chuck");

    expect(events.some((e) => e.type === "PASSIVE_APPLIED" && e.payload.passiveId === "corpse-eater")).toBe(true);
    expect(d.state.characters.chuck.blood).toBe(1);
  });

  it("Dead Man's Luck (Cosgrave) only reduces GM successes once the advance is unlocked", () => {
    const setup = () => {
      const d = makeDriver();
      d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
      d.run({ kind: "start_turn", seat: "cosgrave", stat: "SHOOT" }, sequenceRoller([]), "cosgrave");
      d.run({ kind: "roll", playerPoolDice: 4 }, sequenceRoller([1, 1, 5, 6]), "cosgrave");
      d.run({ kind: "roll_gm" }, sequenceRoller([6, 4, 4]), "gm"); // GM 3 successes
      return d;
    };

    const locked = setup();
    const e1 = locked.run({ kind: "resolve_discard" }, sequenceRoller([]), "cosgrave");
    const discard1 = e1.find((e) => e.type === "DICE_DISCARDED");
    expect(discard1?.type === "DICE_DISCARDED" && discard1.payload.gmSuccessCount).toBe(3); // no reduction

    const unlocked = setup();
    unlocked.run({ kind: "unlock_advance", seat: "cosgrave", advanceId: "dead-mans-luck" }, sequenceRoller([]), "cosgrave");
    const e2 = unlocked.run({ kind: "resolve_discard" }, sequenceRoller([]), "cosgrave");
    const discard2 = e2.find((e) => e.type === "DICE_DISCARDED");
    expect(discard2?.type === "DICE_DISCARDED" && discard2.payload.gmSuccessCount).toBe(1); // 3 − 2 ones
  });
});

describe("processIntent — Vampirjäger 'Anathema' (rulebook p64, issue #21)", () => {
  // attack 3 → a 3-die Reich pool, so [6, 6, 4] is the whole roll: 3 base successes + 2 sixes.
  const cadre: Threat = { id: "cadre", name: "Vampirjäger Cadre", kind: "threat", rating: 8, attack: 3, startingAttack: 3, reinforces: false, restoresAtZero: false, rules: ["anathema", "solo"] };

  const discardWith = (threats: Threat[], gmFaces: DieFace[]) => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    d.run({ kind: "roll", playerPoolDice: 2 }, sequenceRoller([5, 4]), "iryna"); // no 1s → no passives
    d.run({ kind: "roll_gm" }, sequenceRoller(gmFaces), "gm");
    const events = d.run({ kind: "resolve_discard" }, sequenceRoller([]), "iryna");
    return events.find((e) => e.type === "DICE_DISCARDED");
  };

  it("each GM 6 scores 2 successes while the Cadre is in play, and records the bonus", () => {
    const discard = discardWith([cadre], [6, 6, 4]);
    expect(discard?.type === "DICE_DISCARDED" && discard.payload.gmSuccessCount).toBe(5); // 3 base + 2 sixes
    expect(discard?.type === "DICE_DISCARDED" && discard.payload.anathemaBonus).toBe(2);
  });

  it("an ordinary Threat counts a 6 as one success (no bonus field)", () => {
    const discard = discardWith([threat], [6, 6, 4]); // Nazi Squad, no anathema
    expect(discard?.type === "DICE_DISCARDED" && discard.payload.gmSuccessCount).toBe(3);
    expect(discard?.type === "DICE_DISCARDED" && discard.payload.anathemaBonus).toBeUndefined();
  });

  it("a staged Cadre imposes nothing (out of play, issue #12)", () => {
    // Staged alone → uncontested (the GM pool is 0), so pair it with an in-play ordinary Threat
    // to keep a Reich pool; the staged Cadre must still not boost the 6s.
    const discard = discardWith([{ ...cadre, active: false }, { ...threat, attack: 3 }], [6, 6, 4]);
    expect(discard?.type === "DICE_DISCARDED" && discard.payload.gmSuccessCount).toBe(3);
    expect(discard?.type === "DICE_DISCARDED" && discard.payload.anathemaBonus).toBeUndefined();
  });
});

describe("processIntent — Motorcycle 'Crash & Burn' board-granted SPECIAL (#23)", () => {
  const moto: Threat = { id: "moto", name: "Motorcycle Squad", kind: "threat", rating: 10, attack: 3, startingAttack: 3, reinforces: false, restoresAtZero: false, rules: ["crash-and-burn"] };

  it("spending a crit on the granted SPECIAL deals a flat 3 to the squad through to the board", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [moto] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    d.run({ kind: "roll", playerPoolDice: 2 }, sequenceRoller([6, 4]), "iryna"); // a crit (6) + a success
    d.run({ kind: "roll_gm" }, sequenceRoller([4, 2, 2]), "gm"); // one success → no whiff
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "iryna");
    d.run(
      {
        kind: "allocate",
        allocations: [
          { kind: "special", specialId: "crash-and-burn:moto", targetId: "moto", units: 3 },
          { kind: "defend", units: 1 }, // shave the lone GM success so commit closes cleanly
        ],
      },
      sequenceRoller([]),
      "iryna",
    );
    d.run({ kind: "commit" }, sequenceRoller([]), "iryna");

    expect(d.state.board.threats[0]).toMatchObject({ id: "moto", rating: 7 }); // 10 − 3, not the crit's 2
  });
});

describe("processIntent — end of round reinforcements", () => {
  it("server rolls the 1d6 restore and emits the new threat list", () => {
    const squad: Threat = { id: "squad", name: "Infantry Squad", kind: "threat", rating: 0, attack: 0, startingAttack: 3, reinforces: true, restoresAtZero: true };
    const police: Threat = { id: "police", name: "Police Patrol", kind: "threat", rating: 4, attack: 2, startingAttack: 2, reinforces: true, restoresAtZero: true };
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [], threats: [squad, police] });
    d.run({ kind: "end_round", reducedToZeroThreatIds: ["squad"] }, sequenceRoller([4]));

    const out = d.state.board.threats;
    expect(out.find((t) => t.id === "squad")?.attack).toBe(1); // floor(3/2)
    expect(out.find((t) => t.id === "squad")?.rating).toBe(4); // 0 + 1d6(4)
    expect(out.find((t) => t.id === "police")?.attack).toBe(3); // +1 closing in
    expect(d.state.round).toBe(2);
  });

  it("emits the per-threat breakdown with the restore die it rolled (shown with the dice)", () => {
    const squad: Threat = { id: "squad", name: "Infantry Squad", kind: "threat", rating: 0, attack: 0, startingAttack: 3, reinforces: true, restoresAtZero: true };
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [], threats: [squad] });
    const events = d.run({ kind: "end_round", reducedToZeroThreatIds: ["squad"] }, sequenceRoller([4]));

    const applied = events.find((e) => e.type === "REINFORCEMENTS_APPLIED");
    expect(applied?.type === "REINFORCEMENTS_APPLIED" && applied.payload.log).toEqual([
      { threatId: "squad", name: "Infantry Squad", restoreRoll: 4, attackBefore: 0, attackAfter: 1, reason: "defeated this round → +4 rating, Attack reset to floor(3/2)" },
    ]);
  });

  it("a Paratrooper in play gains +1 Attack AND +2 rating, logged with ratingDelta (Rapid Deployment, #22)", () => {
    const para: Threat = { id: "para", name: "Paratrooper Squad", kind: "threat", rating: 6, attack: 3, startingAttack: 3, reinforces: true, restoresAtZero: true, rules: ["rapid-deployment"] };
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [], threats: [para] });
    const events = d.run({ kind: "end_round", reducedToZeroThreatIds: [] }, sequenceRoller([]));

    expect(d.state.board.threats[0]).toMatchObject({ attack: 4, rating: 8 }); // ATK 3→4, rating 6→8
    const applied = events.find((e) => e.type === "REINFORCEMENTS_APPLIED");
    expect(applied?.type === "REINFORCEMENTS_APPLIED" && applied.payload.log?.[0]).toMatchObject({ attackAfter: 4, ratingDelta: 2 });
  });
});

describe("processIntent — Rust-Witch 'Rust Curse' (rulebook p56, issue #13)", () => {
  // In-play Rust-Witch; Iryna's 4 use-tracked items are [rifle, sabre, runes, cigarettes].
  const rustWitch: Threat = { id: "rw", name: "Rust-Witch", kind: "threat", rating: 5, attack: 2, startingAttack: 2, reinforces: false, restoresAtZero: false, rules: ["rust-curse"] };

  it("rusts a server-rolled PC item to uselessness, logged with its die (anti-fudge)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [], threats: [rustWitch] });
    const events = d.run({ kind: "rust_curse", seat: "iryna" }, sequenceRoller([2])); // (2-1)%4 → index 1 → sabre

    const degraded = events.find((e) => e.type === "EQUIPMENT_DEGRADED");
    expect(degraded?.type === "EQUIPMENT_DEGRADED" && degraded.payload).toEqual({
      seat: "iryna",
      itemId: "iryna-sabre",
      itemName: "Magic cavalry sabre",
      roll: 2,
    });
    expect(d.state.characters.iryna.equipmentUses["iryna-sabre"]).toBe(0);
    // Flagged rusted (persists the *why* on the sheet, distinct from merely spent).
    expect(d.state.characters.iryna.degradedEquipment).toContain("iryna-sabre");
    // Nothing else touched.
    expect(d.state.characters.iryna.equipmentUses["iryna-rifle"]).toBe(5);
  });

  it("handing a use back repairs the item — clears the rusted flag", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [], threats: [rustWitch] });
    d.run({ kind: "rust_curse", seat: "iryna" }, sequenceRoller([1])); // index 0 → rifle
    expect(d.state.characters.iryna.degradedEquipment).toContain("iryna-rifle");

    d.run({ kind: "restore_equipment", seat: "iryna", itemId: "iryna-rifle" }, sequenceRoller([]), "iryna");
    expect(d.state.characters.iryna.degradedEquipment).not.toContain("iryna-rifle");
    expect(d.state.characters.iryna.equipmentUses["iryna-rifle"]).toBe(1); // one use handed back
  });

  it("only fires while a Rust-Witch is in play — not absent, not staged (#12)", () => {
    const noWitch = makeDriver();
    noWitch.run({ kind: "frame_scene", objectives: [], threats: [threat] });
    expect(noWitch.fail({ kind: "rust_curse", seat: "iryna" }).ok).toBe(false);

    const staged = makeDriver();
    staged.run({ kind: "frame_scene", objectives: [], threats: [{ ...rustWitch, active: false }] });
    expect(staged.fail({ kind: "rust_curse", seat: "iryna" }).ok).toBe(false);
  });

  it("skips spent gear and fizzles when the PC has nothing left to rust", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [], threats: [rustWitch] });
    // Zero every one of Iryna's items, then there's nothing eligible left.
    for (const itemId of ["iryna-rifle", "iryna-sabre", "iryna-runes", "iryna-cigarettes"]) {
      d.seed([{ type: "EQUIPMENT_DEGRADED", payload: { seat: "iryna", itemId, itemName: itemId, roll: 1 } }]);
    }
    expect(d.fail({ kind: "rust_curse", seat: "iryna" }).ok).toBe(false);
  });
});

describe("processIntent — Einherjar 'Painless' (rulebook p55, issue #19)", () => {
  const einherjar: Threat = { id: "einh", name: "Einherjar", kind: "threat", rating: 7, attack: 3, startingAttack: 3, reinforces: true, restoresAtZero: true, rules: ["painless"] };

  /** Drive iryna up through the GM roll against a board, then resolve the discard. */
  function throughDiscard(threats: Threat[], gmRoll: DieFace[], playerRoll: DieFace[]) {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    d.run({ kind: "roll", playerPoolDice: playerRoll.length }, sequenceRoller(playerRoll), "iryna");
    d.run({ kind: "roll_gm" }, sequenceRoller(gmRoll), "gm");
    const events = d.run({ kind: "resolve_discard" }, sequenceRoller([]), "iryna");
    return { d, events };
  }

  it("raises the Einherjar's Challenge by the count of Reich 1s, and parks it on the turn", () => {
    const { d, events } = throughDiscard([einherjar], [1, 1, 4], [6, 5, 5, 4]); // 2 ones, 1 GM success
    const raises = events.filter((e) => e.type === "ENEMY_CHALLENGE_RAISED");
    expect(raises).toHaveLength(1);
    expect(raises[0]?.payload).toEqual({ threatId: "einh", threatName: "Einherjar", amount: 2, ones: 2, rule: "painless" });
    expect(d.state.currentTurn?.challengeBump).toEqual({ einh: 2 });
  });

  it("the raised Challenge then soaks dice during allocation before rating drops", () => {
    const { d } = throughDiscard([einherjar], [1, 1, 4], [6, 5, 5, 4]); // 5 player units: crit(2)+1+1+1
    d.run(
      {
        kind: "allocate",
        allocations: [
          { kind: "eliminate", targetId: "einh", units: 2 },
          { kind: "eliminate", targetId: "einh", units: 1 },
          { kind: "eliminate", targetId: "einh", units: 1 },
          { kind: "eliminate", targetId: "einh", units: 1 },
        ],
      },
      sequenceRoller([]),
      "iryna",
    );
    // 5 units − 2 soaked by the Painless raise = 3 shed → 7 → 4.
    expect(d.state.board.threats[0]?.rating).toBe(4);
  });

  it("no Reich 1s → no raise, no bump", () => {
    const { d, events } = throughDiscard([einherjar], [4, 5, 6], [5, 5]); // 0 ones
    expect(events.some((e) => e.type === "ENEMY_CHALLENGE_RAISED")).toBe(false);
    expect(d.state.currentTurn?.challengeBump).toBeUndefined();
  });

  it("a staged (#12) Einherjar imposes nothing even when other Threats roll 1s", () => {
    const liveSquad: Threat = { id: "sq", name: "Nazi Squad", kind: "threat", rating: 4, attack: 3, startingAttack: 3, reinforces: true, restoresAtZero: true };
    const { d, events } = throughDiscard([{ ...einherjar, active: false }, liveSquad], [1, 1, 4], [5, 5]);
    expect(events.some((e) => e.type === "ENEMY_CHALLENGE_RAISED")).toBe(false);
    expect(d.state.currentTurn?.challengeBump).toBeUndefined();
  });
});

describe("processIntent — cancelling a turn", () => {
  it("aborts the turn without marking the character as having acted", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    expect(d.state.currentTurn).not.toBeNull();

    d.run({ kind: "cancel_turn" }, sequenceRoller([]), "iryna");
    expect(d.state.currentTurn).toBeNull();
    expect(d.state.activeSeat).toBeNull();
    expect(d.state.actedThisRound).toEqual([]); // can still act this round
  });

  it("rejects cancelling when no turn is in progress", () => {
    const d = makeDriver();
    expect(d.fail({ kind: "cancel_turn" }).ok).toBe(false);
  });

  it("rejects cancelling once the dice are cast — the turn must be seen through (issue #6)", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    d.run({ kind: "roll", playerPoolDice: 2 }, sequenceRoller([5, 4]), "iryna");

    expect(d.fail({ kind: "cancel_turn" }).ok).toBe(false);
    expect(d.state.currentTurn).not.toBeNull(); // turn still live, not aborted
  });
});

describe("processIntent — claiming seats", () => {
  it("stamps the injected token hash into ROLE_CLAIMED and marks the seat claimed", () => {
    const d = makeDriver();
    const r = processIntent(d.state, { kind: "claim_seat", seat: "iryna" }, {
      roller: sequenceRoller([]),
      now: 0,
      actor: "system",
      seatTokenHash: "deadbeef",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const claim = r.events[0];
    expect(claim?.type).toBe("ROLE_CLAIMED");
    expect(claim?.type === "ROLE_CLAIMED" && claim.payload).toEqual({ seat: "iryna", seatTokenHash: "deadbeef" });
  });

  it("rejects a fresh claim of an already-claimed seat", () => {
    const d = makeDriver();
    d.run({ kind: "claim_seat", seat: "iryna" });
    const r = d.fail({ kind: "claim_seat", seat: "iryna" });
    expect(r.ok).toBe(false);
  });
});

describe("processIntent — loot", () => {
  it("grants loot then activates a slot", () => {
    const d = makeDriver();
    d.run({ kind: "loot_add", seat: "nicole", item: { id: "car", name: "Speedster", loot: true } });
    expect(d.state.characters.nicole.loot.map((l) => l.id)).toEqual(["car"]);

    d.run({ kind: "loot_activate", seat: "nicole", itemId: "car" });
    expect(d.state.characters.nicole.activeLootSlot).toBe("car");
  });
});

describe("processIntent — manual injury override (sheet click-to-mark)", () => {
  it("marks an injury box with no Blood cost, recording the 2nd-box penalty", () => {
    const d = makeDriver();
    expect(d.state.characters.chuck.blood).toBe(0);
    expect(d.state.characters.chuck.injuries).toEqual([0, 0, 0]);

    const ev1 = d.run({ kind: "mark_injury", seat: "chuck", category: 0, box: 1 }, sequenceRoller([]), "chuck");
    expect(ev1.map((e) => e.type)).toEqual(["INJURY_MARKED"]);
    expect(d.state.characters.chuck.injuries).toEqual([1, 0, 0]);
    expect(d.state.characters.chuck.blood).toBe(0); // no Blood touched

    const ev2 = d.run({ kind: "mark_injury", seat: "chuck", category: 0, box: 2 }, sequenceRoller([]), "chuck");
    expect(ev2[0]?.payload).toMatchObject({ category: 0, box: 2, penalty: "Spend 1 Blood at the start of your turn" });
    expect(d.state.characters.chuck.injuries).toEqual([2, 0, 0]);
  });

  it("clears a box via heal with no Blood change (undo a mistake)", () => {
    const d = makeDriver();
    d.run({ kind: "mark_injury", seat: "chuck", category: 1, box: 1 }, sequenceRoller([]), "chuck");
    d.run({ kind: "change_blood", seat: "chuck", delta: 5 }, sequenceRoller([]), "chuck");

    const ev = d.run({ kind: "heal", seat: "chuck", category: 1, box: 1 }, sequenceRoller([]), "chuck");
    expect(ev.map((e) => e.type)).toEqual(["HEALED"]); // no BLOOD_CHANGED on the bare heal intent
    expect(d.state.characters.chuck.injuries).toEqual([0, 0, 0]);
    expect(d.state.characters.chuck.blood).toBe(5);
  });
});

describe("processIntent — safety & sessions", () => {
  it("raises the X-Card and resets flashbacks on a new session", () => {
    const d = makeDriver();
    d.run({ kind: "raise_xcard", anonymous: true });
    expect(d.state.safety.xcardRaised).toBe(true);

    // Spend a flashback for real (a weak roll → reroll) so the per-session flag is set.
    d.run({ kind: "start_session" });
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "flint", stat: "BRAWL" }, sequenceRoller([]), "flint");
    d.run({ kind: "roll", playerPoolDice: 3 }, sequenceRoller([2, 3, 1]), "flint"); // 0 successes
    d.run({ kind: "trigger_flashback", seat: "flint" }, sequenceRoller([6, 6, 5, 4, 2]), "flint");
    expect(d.state.characters.flint.flashbackUsedThisSession).toBe(true);

    d.run({ kind: "start_session" });
    expect(d.state.characters.flint.flashbackUsedThisSession).toBe(false);
    expect(d.state.session).toEqual({ number: 2, active: true });
  });
});

describe("processIntent — flashback reroll (RULES §9)", () => {
  /** A session + framed scene + a started turn that has just cast `faces`. */
  function rolled(faces: DieFace[], seat: "iryna" | "flint" = "iryna") {
    const d = makeDriver();
    d.run({ kind: "start_session" });
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat, stat: "SHOOT" }, sequenceRoller([]), seat);
    d.run({ kind: "roll", playerPoolDice: faces.length }, sequenceRoller(faces), seat);
    return d;
  }

  it("on a weak roll, adds 2 dice and rerolls the whole pool — the second result stands", () => {
    const d = rolled([5, 2, 2, 1]); // 1 success → eligible
    const events = d.run(
      { kind: "trigger_flashback", seat: "iryna" },
      sequenceRoller([6, 6, 4, 4, 5, 3]),
      "iryna",
    );
    expect(events.map((e) => e.type)).toEqual(["FLASHBACK_TRIGGERED", "DICE_ROLLED"]);
    expect(d.state.characters.iryna.flashbackUsedThisSession).toBe(true);
    // 4 original + 2 bonus = 6 fresh dice; the first roll is gone.
    expect(d.state.currentTurn?.playerDice).toEqual([6, 6, 4, 4, 5, 3]);
    expect(d.state.currentTurn?.gmDice).toBeUndefined(); // the Reich's beat still lies ahead
    expect(d.state.currentTurn?.survivors).toBeUndefined(); // pre-discard, as before the flashback
  });

  it("a lone crit counts as its 2 successes — exactly on the threshold, so it still qualifies", () => {
    const d = rolled([6, 2, 2]); // 2 units = the threshold
    const r = d.run({ kind: "trigger_flashback", seat: "iryna" }, sequenceRoller([4, 4, 4, 4, 4]), "iryna");
    expect(r.map((e) => e.type)).toEqual(["FLASHBACK_TRIGGERED", "DICE_ROLLED"]);
  });

  it("rejects a flashback when the roll was strong (>2 successes)", () => {
    const d = rolled([6, 6, 5, 1]); // 2+2+1 = 5 units
    const r = d.fail({ kind: "trigger_flashback", seat: "iryna" }, "iryna");
    expect(r.ok).toBe(false);
    expect(d.state.characters.iryna.flashbackUsedThisSession).toBe(false);
  });

  it("rejects a second flashback in the same session", () => {
    const d = rolled([2, 2, 2]);
    d.run({ kind: "trigger_flashback", seat: "iryna" }, sequenceRoller([2, 2, 2, 2, 2]), "iryna");
    // Still a weak (rerolled) result, but the flashback is spent for the session.
    const r = d.fail({ kind: "trigger_flashback", seat: "iryna" }, "iryna");
    expect(r.ok).toBe(false);
  });

  it("rejects a flashback before the roll and after the discard", () => {
    const d = makeDriver();
    d.run({ kind: "start_session" });
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    // before the roll
    expect(d.fail({ kind: "trigger_flashback", seat: "iryna" }, "iryna").ok).toBe(false);
    // after the discard locks the result in
    d.run({ kind: "roll", playerPoolDice: 3 }, sequenceRoller([2, 2, 1]), "iryna");
    d.run({ kind: "roll_gm" }, sequenceRoller([1, 1, 1]), "gm");
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "iryna");
    expect(d.fail({ kind: "trigger_flashback", seat: "iryna" }, "iryna").ok).toBe(false);
  });

  it("rejects a flashback when the session hasn't started", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    d.run({ kind: "roll", playerPoolDice: 3 }, sequenceRoller([2, 2, 1]), "iryna");
    expect(d.fail({ kind: "trigger_flashback", seat: "iryna" }, "iryna").ok).toBe(false);
  });

  it("the rerolled pool drives the rest of the turn normally", () => {
    const d = rolled([2, 2, 2, 1]); // whiffed — 0 successes
    // Cut to a flashback; the second roll comes up hot.
    d.run({ kind: "trigger_flashback", seat: "iryna" }, sequenceRoller([6, 5, 4, 4, 2, 1]), "iryna");
    d.run({ kind: "roll_gm" }, sequenceRoller([1, 1, 1]), "gm"); // Reich whiffs
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "iryna");
    // 6,5,4,4 survive (2+1+1+1 = 5 units) → spend 3 advancing the rating-6 Objective.
    d.run(
      { kind: "allocate", allocations: [{ kind: "advance", targetId: "obj1", units: 2 }, { kind: "advance", targetId: "obj1", units: 1 }] },
      sequenceRoller([]),
      "iryna",
    );
    d.run({ kind: "commit" }, sequenceRoller([]), "iryna");
    expect(d.state.board.objectives[0]?.rating).toBe(3);
    expect(d.state.currentTurn).toBeNull();
    expect(d.state.actedThisRound).toEqual(["iryna"]);
  });
});

describe("processIntent — freeform out-of-turn roll (issue #17)", () => {
  it("a player throws vampire dice; the server rolls them and parks the result on their seat", () => {
    const d = makeDriver();
    const events = d.run({ kind: "freeform_roll", seat: "iryna", count: 3 }, sequenceRoller([6, 4, 2]), "iryna");
    expect(events.map((e) => ({ type: e.type, payload: e.payload }))).toEqual([
      { type: "FREEFORM_ROLLED", payload: { seat: "iryna", kind: "player", faces: [6, 4, 2] } },
    ]);
    expect(d.state.freeformRolls.iryna).toEqual({ kind: "player", faces: [6, 4, 2] });
  });

  it("the GM throws the Reich's bone dice (kind 'gm'), parked on the 'gm' seat", () => {
    const d = makeDriver();
    d.run({ kind: "freeform_roll", seat: "gm", count: 2 }, sequenceRoller([5, 1]), "gm");
    expect(d.state.freeformRolls.gm).toEqual({ kind: "gm", faces: [5, 1] });
  });

  it("a fresh throw replaces the seat's prior result", () => {
    const d = makeDriver();
    d.run({ kind: "freeform_roll", seat: "nicole", count: 1 }, sequenceRoller([3]), "nicole");
    d.run({ kind: "freeform_roll", seat: "nicole", count: 2 }, sequenceRoller([6, 6]), "nicole");
    expect(d.state.freeformRolls.nicole).toEqual({ kind: "player", faces: [6, 6] });
  });

  it("clamps the count to [1, FREEFORM_MAX_DICE] (anti-grief)", () => {
    const tooMany = makeDriver();
    // Ask for 99 → only 10 dice are rolled; the roller must supply exactly that many.
    tooMany.run({ kind: "freeform_roll", seat: "chuck", count: 99 }, sequenceRoller([1, 2, 3, 4, 5, 6, 1, 2, 3, 4]), "chuck");
    expect(tooMany.state.freeformRolls.chuck?.faces).toHaveLength(FREEFORM_MAX_DICE);

    const tooFew = makeDriver();
    tooFew.run({ kind: "freeform_roll", seat: "chuck", count: 0 }, sequenceRoller([5]), "chuck");
    expect(tooFew.state.freeformRolls.chuck?.faces).toEqual([5]); // floored up to 1
  });

  it("is refused while a turn is occupying the arena", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    const r = d.fail({ kind: "freeform_roll", seat: "iryna", count: 2 }, "iryna");
    expect(r.ok).toBe(false);
    expect(d.state.freeformRolls.iryna).toBeUndefined();
  });
});

describe("processIntent — Secondary Objectives advance in dice resolution (issue #51)", () => {
  // A board with the standard primary + Threat plus a revealed plain Secondary Objective.
  function framed(secondaryRating: number) {
    const d = makeDriver();
    d.run({
      kind: "frame_scene",
      objectives: [objective],
      threats: [threat],
      secondaryObjectives: [{ id: "sec", name: "Power up the platform", kind: "secondary", rating: secondaryRating }],
    });
    return d;
  }

  // Drive Iryna to the ALLOCATE phase with two survivor successes and a harmless Reich roll (no injury).
  function toAllocate(d: ReturnType<typeof makeDriver>) {
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    d.run({ kind: "roll", playerPoolDice: 2 }, sequenceRoller([5, 4]), "iryna"); // two successes survive
    d.run({ kind: "roll_gm" }, sequenceRoller([2, 2, 2]), "gm"); // zero Reich successes
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "iryna");
  }

  it("an `advance` die reduces a Secondary's rating; clearing it to 0 auto-completes it", () => {
    const d = framed(2);
    toAllocate(d);
    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "advance", targetId: "sec", units: 1 }, { kind: "advance", targetId: "sec", units: 1 }] },
      sequenceRoller([]),
      "iryna",
    );
    expect(events.some((e) => e.type === "SECONDARY_OBJECTIVE_COMPLETED" && (e.payload as { id: string }).id === "sec")).toBe(true);
    expect(d.state.board.secondaryObjectives.find((o) => o.id === "sec")!.rating).toBe(0);
  });

  it("a partial advance leaves the Secondary open (no completion event)", () => {
    const d = framed(3);
    toAllocate(d);
    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "advance", targetId: "sec", units: 1 }, { kind: "advance", targetId: "sec", units: 1 }] },
      sequenceRoller([]),
      "iryna",
    );
    expect(events.some((e) => e.type === "SECONDARY_OBJECTIVE_COMPLETED")).toBe(false);
    expect(d.state.board.secondaryObjectives.find((o) => o.id === "sec")!.rating).toBe(1);
  });

  it("clearing a rescue Secondary with dice brings the Downed vampire back up (RULES §5)", () => {
    // Down Astrid (3 leftover Reich dice → Downed), which auto-spawns her rescue Secondary.
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "astrid", stat: "BRAWL" }, sequenceRoller([]), "astrid");
    d.run({ kind: "roll", playerPoolDice: 3 }, sequenceRoller([5, 4, 2]), "astrid");
    d.run({ kind: "roll_gm" }, sequenceRoller([6, 6, 4]), "gm");
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "astrid");
    d.run({ kind: "allocate", allocations: [{ kind: "advance", targetId: "obj1", units: 1 }, { kind: "advance", targetId: "obj1", units: 1 }] }, sequenceRoller([]), "astrid");
    d.run({ kind: "commit" }, sequenceRoller([]), "astrid");
    d.run({ kind: "roll_injury" }, sequenceRoller([5]), "astrid");
    d.run({ kind: "resolve_injury" }, sequenceRoller([]), "astrid");
    const rescueId = d.state.characters.astrid.rescueObjectiveId!;
    expect(d.state.characters.astrid.downed).toBe(true);

    // The GM reveals the rescue and sets its rating to 2; Iryna then clears it with two successes.
    d.run({ kind: "update_secondary_objective", id: rescueId, patch: { revealed: true, rating: 2 } });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT" }, sequenceRoller([]), "iryna");
    d.run({ kind: "roll", playerPoolDice: 2 }, sequenceRoller([5, 4]), "iryna");
    d.run({ kind: "roll_gm" }, sequenceRoller([2, 2, 2]), "gm");
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "iryna");
    const events = d.run(
      { kind: "allocate", allocations: [{ kind: "advance", targetId: rescueId, units: 1 }, { kind: "advance", targetId: rescueId, units: 1 }] },
      sequenceRoller([]),
      "iryna",
    );

    expect(events.some((e) => e.type === "SECONDARY_OBJECTIVE_COMPLETED")).toBe(true);
    expect(d.state.characters.astrid.downed).toBe(false);
    expect(d.state.characters.astrid.rescueObjectiveId).toBeUndefined();
  });
});
