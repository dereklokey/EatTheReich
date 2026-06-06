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

  it("commit marks an Injury when GM dice are left after Defend", () => {
    const d = makeDriver();
    d.run({ kind: "frame_scene", objectives: [objective], threats: [threat] });
    d.run({ kind: "start_turn", seat: "astrid", stat: "BRAWL", engagedThreatIds: ["thr1"] }, sequenceRoller([]), "astrid");
    // player rolls two successes, GM rolls 6,6,4 = 3 successes
    d.run({ kind: "roll", playerPoolDice: 3 }, sequenceRoller([5, 4, 2, 6, 6, 4]), "astrid");
    d.run({ kind: "resolve_discard" }, sequenceRoller([]), "astrid");
    // allocate both successes to the objective (no Defend) → 3 GM dice remain
    d.run({ kind: "allocate", allocations: [{ kind: "advance", targetId: "obj1", units: 1 }, { kind: "advance", targetId: "obj1", units: 1 }] }, sequenceRoller([]), "astrid");
    // 3 leftover → Downed; category from d6=5 → category 2
    d.run({ kind: "commit" }, sequenceRoller([5]), "astrid");

    expect(d.state.characters.astrid.downed).toBe(true);
    expect(d.state.characters.astrid.injuries[2]).toBe(2); // all boxes in category 2
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
    const ev = d.run({ kind: "commit" }, sequenceRoller([3]), "iryna"); // 1 leftover → injury → nowhere free → death

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
