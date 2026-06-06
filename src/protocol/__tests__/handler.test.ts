import { describe, it, expect } from "vitest";
import { processIntent } from "../handler.js";
import type { EventInput } from "../handler.js";
import type { Intent } from "../messages.js";
import { initialState } from "../../state/init.js";
import { applyEvent } from "../../state/reducer.js";
import { makeEvent } from "../../events/types.js";
import type { Actor, GameEvent } from "../../events/types.js";
import { sequenceRoller } from "../../domain/dice.js";
import type { DiceRoller } from "../../domain/dice.js";
import type { Objective, Threat } from "../../domain/types.js";

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
  it("builds the GM pool itself and emits the rolled results as events", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT", engagedThreatIds: ["thr1"] }, sequenceRoller([]), "iryna");

    const events = d.run(
      { kind: "roll", playerPoolDice: 6 },
      sequenceRoller([6, 5, 4, 2, 2, 1, /* gm: */ 6, 4, 1]),
      "iryna",
    );

    const byType = (t: string) => events.filter((e) => e.type === t);
    expect(byType("POOL_BUILT").map((e) => e.payload)).toEqual([
      { who: "player", dice: 6, sources: [] },
      { who: "gm", dice: 3 }, // server computed from the engaged threat's Attack
    ]);
    const rolls = byType("DICE_ROLLED").map((e) => e.payload);
    expect(rolls).toEqual([
      { who: "player", results: [6, 5, 4, 2, 2, 1] },
      { who: "gm", results: [6, 4, 1] },
    ]);
  });

  it("rejects rolling with no turn in progress", () => {
    const d = makeDriver();
    const r = d.fail({ kind: "roll", playerPoolDice: 4 });
    expect(r.ok).toBe(false);
  });
});

describe("processIntent — full §12-A turn driven by intents", () => {
  it("reduces the Objective 6 → 3 and takes no Injury", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT", engagedThreatIds: ["thr1"] }, sequenceRoller([]), "iryna");
    d.run({ kind: "roll", playerPoolDice: 6 }, sequenceRoller([6, 5, 4, 2, 2, 1, 6, 4, 1]), "iryna");
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
    d.run({ kind: "start_turn", seat: "astrid", stat: "BRAWL", engagedThreatIds: ["thr1"] }, sequenceRoller([]), "astrid");
    // player rolls two successes, GM rolls 6,6,4 = 3 successes
    d.run({ kind: "roll", playerPoolDice: 3 }, sequenceRoller([5, 4, 2, 6, 6, 4]), "astrid");
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "astrid");
    // allocate both successes to the objective (no Defend) → 3 GM dice remain
    d.run({ kind: "allocate", allocations: [{ kind: "advance", targetId: "obj1", units: 1 }, { kind: "advance", targetId: "obj1", units: 1 }] }, sequenceRoller([]), "astrid");
    // 3 leftover → Downed; category from d6=5 → category 2. Commit only PARKS it now.
    const parked = d.run({ kind: "commit" }, sequenceRoller([5]), "astrid");
    expect(parked.map((e) => e.type)).toEqual(["INJURY_PENDING"]);
    expect(d.state.characters.astrid.downed).toBe(false); // not applied yet — the window is open
    expect(d.state.currentTurn?.pendingInjury).toMatchObject({ face: 5, outcome: { kind: "downed", category: 2 } });
    expect(d.state.actedThisRound).toEqual([]); // turn hasn't closed

    // Resolving applies the box and closes the turn.
    const resolved = d.run({ kind: "resolve_injury" }, sequenceRoller([]), "astrid");
    expect(resolved.map((e) => e.type)).toEqual(["DOWNED", "ALLOCATION_COMMITTED"]);
    expect(d.state.characters.astrid.downed).toBe(true);
    expect(d.state.characters.astrid.injuries[2]).toBe(2); // all boxes in category 2
    expect(d.state.currentTurn).toBeNull();
    expect(d.state.actedThisRound).toEqual(["astrid"]);
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
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT", engagedThreatIds: ["thr1"] }, sequenceRoller([]), "iryna");
    // player 5,4 (2 successes); GM 6,2,2 (1 success)
    d.run({ kind: "roll", playerPoolDice: 2 }, sequenceRoller([5, 4, 6, 2, 2]), "iryna");
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "iryna");
    d.run({ kind: "allocate", allocations: [{ kind: "advance", targetId: "obj1", units: 1 }] }, sequenceRoller([]), "iryna"); // no Defend → 1 GM die left
    const parked = d.run({ kind: "commit" }, sequenceRoller([3]), "iryna"); // 1 leftover → injury → nowhere free → death
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
    d.run({ kind: "start_turn", seat, stat: "SHOOT", engagedThreatIds: ["thr1"] }, sequenceRoller([]), seat);
    d.run({ kind: "roll", playerPoolDice: 2 }, sequenceRoller([5, 2, 6, 2, 2]), seat); // 1 survivor (5); GM 1 succ
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
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT", engagedThreatIds: ["thr1"] }, sequenceRoller([]), "iryna");
    // No discard yet → no survivors → not in allocation.
    expect(d.fail({ kind: "add_bonus_dice", count: 1 }, "iryna").ok).toBe(false);
  });

  it("respects an engaged Rust-Witch's raised discard threshold", () => {
    const rustWitch: Threat = { id: "rw", name: "Rust-Witch", kind: "threat", rating: 3, attack: 2, startingAttack: 2, reinforces: false, restoresAtZero: false, discardThreshold: 4 };
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [rustWitch] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT", engagedThreatIds: ["rw"] }, sequenceRoller([]), "iryna");
    d.run({ kind: "roll", playerPoolDice: 1 }, sequenceRoller([6, 2, 2]), "iryna"); // crit survives; GM 0 succ
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
    d.run({ kind: "start_turn", seat, stat: "BRAWL", engagedThreatIds: ["thr1"] }, sequenceRoller([]), seat);
    d.run({ kind: "roll", playerPoolDice: 2 }, sequenceRoller([5, 4, 6, 2, 2]), seat); // player 2 succ; GM (3 dice) 1 succ
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), seat);
    d.run({ kind: "allocate", allocations: [{ kind: "advance", targetId: "obj1", units: 1 }, { kind: "advance", targetId: "obj1", units: 1 }] }, sequenceRoller([]), seat); // no Defend → 1 GM left
    d.run({ kind: "commit" }, sequenceRoller([1]), seat); // 1 leftover → injury, d6=1 → category 0
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

  it("using Iryna's cigarettes regains 2 Blood automatically (and only while a use remains)", () => {
    const d = makeDriver();
    expect(d.state.characters.iryna.blood).toBe(0);

    const ev = d.run({ kind: "use_equipment", seat: "iryna", itemId: "iryna-cigarettes" }, sequenceRoller([]), "iryna");
    expect(ev.map((e) => e.type)).toEqual(["EQUIPMENT_USED", "BLOOD_CHANGED"]);
    expect(d.state.characters.iryna.blood).toBe(2);
    expect(d.state.characters.iryna.equipmentUses["iryna-cigarettes"]).toBe(0);

    // Depleted now → using again no longer mints Blood.
    const ev2 = d.run({ kind: "use_equipment", seat: "iryna", itemId: "iryna-cigarettes" }, sequenceRoller([]), "iryna");
    expect(ev2.map((e) => e.type)).toEqual(["EQUIPMENT_USED"]);
    expect(d.state.characters.iryna.blood).toBe(2);
  });

  it("a weapon use grants no Blood (only reactive items do)", () => {
    const d = makeDriver();
    const ev = d.run({ kind: "use_equipment", seat: "iryna", itemId: "iryna-sabre" }, sequenceRoller([]), "iryna");
    expect(ev.map((e) => e.type)).toEqual(["EQUIPMENT_USED"]);
    expect(d.state.characters.iryna.blood).toBe(0);
  });
});

describe("processIntent — pre-discard passives", () => {
  it("Corpse Eater (Chuck) grants +1 Blood on a rolled 1", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "chuck", stat: "SHOOT", engagedThreatIds: ["thr1"] }, sequenceRoller([]), "chuck");
    d.run({ kind: "roll", playerPoolDice: 3 }, sequenceRoller([1, 5, 4, 4, 4, 4]), "chuck");
    const events = d.run({ kind: "resolve_discard" }, sequenceRoller([]), "chuck");

    expect(events.some((e) => e.type === "PASSIVE_APPLIED" && e.payload.passiveId === "corpse-eater")).toBe(true);
    expect(d.state.characters.chuck.blood).toBe(1);
  });

  it("Dead Man's Luck (Cosgrave) only reduces GM successes once the advance is unlocked", () => {
    const setup = () => {
      const d = makeDriver();
      d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
      d.run({ kind: "start_turn", seat: "cosgrave", stat: "SHOOT", engagedThreatIds: ["thr1"] }, sequenceRoller([]), "cosgrave");
      d.run({ kind: "roll", playerPoolDice: 4 }, sequenceRoller([1, 1, 5, 6, 6, 4, 4]), "cosgrave");
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
});

describe("processIntent — cancelling a turn", () => {
  it("aborts the turn without marking the character as having acted", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "iryna", stat: "SHOOT", engagedThreatIds: ["thr1"] }, sequenceRoller([]), "iryna");
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

describe("processIntent — safety & sessions", () => {
  it("raises the X-Card and resets flashbacks on a new session", () => {
    const d = makeDriver();
    d.run({ kind: "raise_xcard", anonymous: true });
    expect(d.state.safety.xcardRaised).toBe(true);

    d.run({ kind: "trigger_flashback", seat: "flint", context: "submarine", question: "q" }, sequenceRoller([]), "flint");
    expect(d.state.characters.flint.flashbackUsedThisSession).toBe(true);

    d.run({ kind: "start_session" });
    expect(d.state.characters.flint.flashbackUsedThisSession).toBe(false);
    expect(d.state.session).toEqual({ number: 1, active: true });
  });
});
