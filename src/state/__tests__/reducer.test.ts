import { describe, it, expect } from "vitest";
import { makeEvent } from "../../events/types.js";
import type { GameEvent, EventType, EventPayloads, Actor } from "../../events/types.js";
import { reduce, applyEvent } from "../reducer.js";
import { initialState } from "../init.js";
import { infantrySquad } from "../../data/threats.js";

const GAME = "g-test";
function log(): { ev: <T extends EventType>(t: T, p: EventPayloads[T], a?: Actor) => GameEvent; all: GameEvent[] } {
  let seq = 0;
  const all: GameEvent[] = [];
  const ev = <T extends EventType>(type: T, payload: EventPayloads[T], actor: Actor = "gm"): GameEvent => {
    const e = makeEvent({ id: `e${++seq}`, gameId: GAME, seq, actor, ts: seq }, type, payload) as GameEvent;
    all.push(e);
    return e;
  };
  return { ev, all };
}

describe("reducer — lifecycle & seats", () => {
  it("GAME_CREATED sets createdAt; seq tracks the last event", () => {
    const { ev, all } = log();
    ev("GAME_CREATED", { createdAt: 42 });
    const s = reduce(all);
    expect(s.createdAt).toBe(42);
    expect(s.seq).toBe(1);
    expect(s.lifecycle).toBe("lobby");
  });

  it("ROLE_CLAIMED claims a seat (token hash only); SEAT_RELEASED frees it", () => {
    const { ev, all } = log();
    ev("GAME_CREATED", { createdAt: 1 });
    ev("ROLE_CLAIMED", { seat: "iryna", seatTokenHash: "h" }, "iryna");
    let s = reduce(all);
    expect(s.seats.iryna).toEqual({ claimed: true, seatTokenHash: "h" });

    s = applyEvent(s, ev("SEAT_RELEASED", { seat: "iryna" }));
    expect(s.seats.iryna).toEqual({ claimed: false });
  });
});

describe("reducer — sessions reset flashbacks (RULES §9 / §3A)", () => {
  it("SESSION_STARTED bumps the number, activates, and clears flashbackUsedThisSession", () => {
    const { ev, all } = log();
    ev("GAME_CREATED", { createdAt: 1 });
    ev("SESSION_STARTED", {});
    ev("FLASHBACK_TRIGGERED", { seat: "chuck", context: "opera", question: "q" }, "chuck");
    let s = reduce(all);
    expect(s.characters.chuck.flashbackUsedThisSession).toBe(true);
    expect(s.session).toEqual({ number: 1, active: true });

    s = applyEvent(s, ev("SESSION_STARTED", {}));
    expect(s.characters.chuck.flashbackUsedThisSession).toBe(false);
    expect(s.session).toEqual({ number: 2, active: true });
  });
});

describe("reducer — safety bar", () => {
  it("SAFETY_SET merges; XCARD raises/clears; TRAFFIC_SIGNAL sets colour", () => {
    const { ev, all } = log();
    ev("SAFETY_SET", { lines: ["no eyes"], veils: ["torture"] });
    ev("SAFETY_SET", { calibration: ["tier 1"] }); // merge, doesn't wipe lines
    ev("XCARD_RAISED", { anonymous: true });
    ev("TRAFFIC_SIGNAL", { color: "amber" });
    let s = reduce(all);
    expect(s.safety.lines).toEqual(["no eyes"]);
    expect(s.safety.calibration).toEqual(["tier 1"]);
    expect(s.safety.xcardRaised).toBe(true);
    expect(s.safety.traffic).toBe("amber");

    s = applyEvent(s, ev("XCARD_CLEARED", {}));
    expect(s.safety.xcardRaised).toBe(false);
  });
});

describe("reducer — board & blood", () => {
  it("THREAT_REMOVED / OBJECTIVE_COMPLETED / REINFORCEMENTS_APPLIED", () => {
    const squad = infantrySquad();
    const { ev, all } = log();
    ev("SCENE_FRAMED", {
      objectives: [{ id: "o1", name: "door", kind: "objective", rating: 3 }],
      threats: [squad],
    });
    ev("OBJECTIVE_COMPLETED", { id: "o1", narratedBy: "astrid" });
    let s = reduce(all);
    expect(s.board.objectives[0]?.rating).toBe(0);

    s = applyEvent(s, ev("REINFORCEMENTS_APPLIED", { threats: [{ ...squad, attack: 4 }] }));
    expect(s.board.threats[0]?.attack).toBe(4);

    s = applyEvent(s, ev("THREAT_REMOVED", { id: squad.id }));
    expect(s.board.threats).toHaveLength(0);
  });

  it("SCENE_FRAMED carries scene + locationId; SCENE_SET edits and clears the scene (issue #4)", () => {
    const { ev, all } = log();
    ev("SCENE_FRAMED", {
      objectives: [],
      threats: [],
      scene: { title: "The German Technology Pavilion" },
      locationId: "german-technology-pavilion",
    });
    let s = reduce(all);
    expect(s.board.scene).toEqual({ title: "The German Technology Pavilion" });
    expect(s.board.locationId).toBe("german-technology-pavilion");

    // A manual edit keeps the title and adds a note.
    s = applyEvent(s, ev("SCENE_SET", { title: "Pavilion — second floor", note: "alarms blaring" }));
    expect(s.board.scene).toEqual({ title: "Pavilion — second floor", note: "alarms blaring" });
    // locationId survives a manual scene edit.
    expect(s.board.locationId).toBe("german-technology-pavilion");

    // An empty title clears the scene.
    s = applyEvent(s, ev("SCENE_SET", { title: "   " }));
    expect(s.board.scene).toBeNull();
  });

  it("secondary objectives: ADDED / UPDATED / COMPLETED(reward) / REMOVED (issue #4)", () => {
    const { ev, all } = log();
    ev("SECONDARY_OBJECTIVE_ADDED", { objective: { id: "s1", name: "Power up the platform", kind: "secondary", rating: 5 } });
    let s = reduce(all);
    expect(s.board.secondaryObjectives).toHaveLength(1);

    s = applyEvent(s, ev("SECONDARY_OBJECTIVE_UPDATED", { id: "s1", patch: { rating: 3, challenge: 1 } }));
    expect(s.board.secondaryObjectives[0]).toMatchObject({ rating: 3, challenge: 1 });

    s = applyEvent(s, ev("SECONDARY_OBJECTIVE_COMPLETED", { id: "s1", rewardChoice: "gain-blood-d6" }));
    expect(s.board.secondaryObjectives[0]).toMatchObject({ rating: 0, rewardChoice: "gain-blood-d6" });

    s = applyEvent(s, ev("SECONDARY_OBJECTIVE_REMOVED", { id: "s1" }));
    expect(s.board.secondaryObjectives).toHaveLength(0);
  });

  it("BLOOD_CHANGED clamps 0–10; BLOOD_SHARED transfers within the cap", () => {
    const { ev, all } = log();
    ev("BLOOD_CHANGED", { seat: "flint", delta: 8 }, "flint");
    ev("BLOOD_CHANGED", { seat: "flint", delta: 5 }, "flint"); // 13 → clamps to 10
    let s = reduce(all);
    expect(s.characters.flint.blood).toBe(10);

    s = applyEvent(s, ev("BLOOD_SHARED", { from: "flint", to: "nicole", amount: 4 }));
    expect(s.characters.flint.blood).toBe(6);
    expect(s.characters.nicole.blood).toBe(4);
  });
});

describe("reducer — injuries, downed, equipment, advances", () => {
  it("INJURY_MARKED 2nd box records the penalty; DOWNED marks all boxes", () => {
    const { ev, all } = log();
    ev("INJURY_MARKED", { seat: "chuck", category: 0, box: 2, penalty: "Spend 1 Blood at the start of your turn" }, "chuck");
    let s = reduce(all);
    expect(s.characters.chuck.injuries[0]).toBe(2);
    expect(s.characters.chuck.triggeredPenalties).toContain("Spend 1 Blood at the start of your turn");

    s = applyEvent(s, ev("DOWNED", { seat: "chuck", category: 1 }, "chuck"));
    expect(s.characters.chuck.injuries[1]).toBe(2);
    expect(s.characters.chuck.downed).toBe(true);
  });

  it("EQUIPMENT_USED decrements a tracked item; ADVANCE_UNLOCKED records an advance", () => {
    const { ev, all } = log();
    // Nicole's panzerfaust starts with 1 use.
    ev("EQUIPMENT_USED", { seat: "nicole", itemId: "nicole-panzerfaust" }, "nicole");
    ev("ADVANCE_UNLOCKED", { seat: "nicole", advanceId: "nicole-feed-on-fear" }, "nicole");
    const s = reduce(all);
    expect(s.characters.nicole.equipmentUses["nicole-panzerfaust"]).toBe(0);
    expect(s.characters.nicole.unlockedAdvances).toContain("nicole-feed-on-fear");
  });

  it("EQUIPMENT_RESTORED gives a use back but never exceeds the item's max", () => {
    const { ev, all } = log();
    // Chuck's revolvers start with 5 uses: spend two, restore three (capped back at 5).
    ev("EQUIPMENT_USED", { seat: "chuck", itemId: "chuck-revolvers" }, "chuck");
    ev("EQUIPMENT_USED", { seat: "chuck", itemId: "chuck-revolvers" }, "chuck");
    ev("EQUIPMENT_RESTORED", { seat: "chuck", itemId: "chuck-revolvers" }, "chuck");
    ev("EQUIPMENT_RESTORED", { seat: "chuck", itemId: "chuck-revolvers" }, "chuck");
    ev("EQUIPMENT_RESTORED", { seat: "chuck", itemId: "chuck-revolvers" }, "chuck");
    const s = reduce(all);
    expect(s.characters.chuck.equipmentUses["chuck-revolvers"]).toBe(5);
  });
});

describe("reducer — purity", () => {
  it("applyEvent does not mutate its input state", () => {
    const before = initialState(GAME);
    const frozen = JSON.stringify(before);
    const { ev } = log();
    applyEvent(before, ev("BLOOD_CHANGED", { seat: "iryna", delta: 5 }, "iryna"));
    expect(JSON.stringify(before)).toBe(frozen);
  });
});
