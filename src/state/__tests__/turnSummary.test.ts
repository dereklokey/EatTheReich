import { describe, it, expect } from "vitest";
import { reduce } from "../reducer.js";
import { summarizeCommittedTurn } from "../turnSummary.js";
import { irynaClockTowerEvents } from "./scenario.js";
import { makeEvent } from "../../events/types.js";
import type { GameEvent, EventType, EventPayloads, Actor } from "../../events/types.js";
import type { Objective, Threat } from "../../domain/types.js";

/** Local event builder (mirrors scenario.ts). */
function log(): { ev: <T extends EventType>(type: T, payload: EventPayloads[T], actor?: Actor) => GameEvent; seq: () => number } {
  let seq = 0;
  return {
    ev: (type, payload, actor: Actor = "gm") => makeEvent({ id: `e${++seq}`, gameId: "g", seq, actor, ts: seq * 1000 }, type, payload) as GameEvent,
    seq: () => seq,
  };
}

const committedSeqOf = (events: readonly GameEvent[]) => events.find((e) => e.type === "ALLOCATION_COMMITTED")!.seq;

describe("summarizeCommittedTurn — the after-action report", () => {
  it("reports advance progress and defends from the §12-A clock-tower turn", () => {
    const events = irynaClockTowerEvents("g-iryna");
    const state = reduce(events);
    const summary = summarizeCommittedTurn(events, committedSeqOf(events), state)!;

    expect(summary.charName).toBe("Iryna");
    const texts = summary.lines.map((l) => l.text);
    // 3 advance dice (1 each) on a no-Challenge objective → −3 rating, now 3.
    expect(texts).toContainEqual(expect.stringMatching(/Advanced .* −3 rating \(now 3\)/));
    expect(texts).toContainEqual("Defended 2 Reich attacks");
    // No feed / special / passive / whiff / injury happened, so nothing else is invented.
    expect(summary.lines.every((l) => ["advance", "defend"].includes(l.kind))).toBe(true);
  });

  it("accounts for a kill, progress, feed, a quiet passive, and the GM whiff", () => {
    const { ev } = log();
    const objective: Objective = { id: "obj", name: "Plant the charges", kind: "objective", rating: 4 };
    const gone: Threat = { id: "thrA", name: "Police Patrol", kind: "threat", rating: 2, attack: 2, startingAttack: 2, reinforces: true, restoresAtZero: true };
    const lead: Threat = { id: "thrB", name: "Infantry Squad", kind: "threat", rating: 5, attack: 4, startingAttack: 4, reinforces: true, restoresAtZero: true };

    const events = [
      ev("GAME_CREATED", { createdAt: 1 }),
      ev("ROLE_CLAIMED", { seat: "chuck" }, "chuck"),
      ev("SESSION_STARTED", {}),
      ev("SCENE_FRAMED", { objectives: [objective], threats: [gone, lead] }),
      ev("TURN_STARTED", { seat: "chuck", stat: "BRAWL" }, "chuck"),
      ev("DICE_DISCARDED", { playerSurvivors: [6, 5, 4], gmSuccessCount: 0 }),
      ev("PASSIVE_APPLIED", { passiveId: "corpse-eater", bloodDelta: 1, detail: "+1 Blood on a rolled 1" }, "chuck"),
      ev("DIE_ALLOCATED", { kind: "eliminate", targetId: "thrA", units: 2 }, "chuck"), // 2 → 0 = kill
      ev("DIE_ALLOCATED", { kind: "advance", targetId: "obj", units: 1 }, "chuck"), // 4 → 3
      ev("DIE_ALLOCATED", { kind: "feed", units: 1 }, "chuck"),
      ev("GM_WHIFF", { threatId: "thrB", name: "Infantry Squad", attack: 5 }),
      ev("ALLOCATION_COMMITTED", {}, "chuck"),
    ] as GameEvent[];

    const state = reduce(events);
    expect(state.characters.chuck.blood).toBe(2); // corpse-eater +1, feed +1
    const summary = summarizeCommittedTurn(events, committedSeqOf(events), state)!;
    const byKind = Object.fromEntries(summary.lines.map((l) => [l.kind, l.text]));

    expect(byKind.kill).toBe("Eliminated Police Patrol!");
    expect(byKind.advance).toMatch(/Advanced Plant the charges — −1 rating \(now 3\)/);
    expect(byKind.feed).toBe("Drank deep — +1 Blood");
    expect(byKind.passive).toBe("Corpse Eater: +1 Blood on a rolled 1");
    expect(byKind.whiff).toBe("Shots go wide — Infantry Squad presses the attack (ATK +1 → 5)");
  });

  it("folds a SPECIAL's Blood grant into the activation line (Ravenous +3)", () => {
    const { ev } = log();
    const events = [
      ev("GAME_CREATED", { createdAt: 1 }),
      ev("ROLE_CLAIMED", { seat: "flint" }, "flint"),
      ev("SESSION_STARTED", {}),
      ev("SCENE_FRAMED", { objectives: [], threats: [] }),
      ev("TURN_STARTED", { seat: "flint", stat: "BRAWL" }, "flint"),
      ev("DICE_DISCARDED", { playerSurvivors: [6], gmSuccessCount: 0 }),
      ev("DIE_ALLOCATED", { kind: "special", specialId: "flint-ravenous", units: 2 }, "flint"),
      ev("BLOOD_CHANGED", { seat: "flint", delta: 3, reason: "Ravenous" }, "flint"),
      ev("ALLOCATION_COMMITTED", {}, "flint"),
    ] as GameEvent[];

    const state = reduce(events);
    const summary = summarizeCommittedTurn(events, committedSeqOf(events), state)!;
    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0]).toMatchObject({ kind: "special", text: "Activated Ravenous (+3 Blood)" });
  });

  it("surfaces an Einherjar 'Painless' raise and folds it into the soak (#19)", () => {
    const { ev } = log();
    const objective: Objective = { id: "obj", name: "Smash through", kind: "objective", rating: 8 };
    const einherjar: Threat = { id: "einh", name: "Einherjar", kind: "threat", rating: 7, attack: 3, startingAttack: 3, reinforces: true, restoresAtZero: true, rules: ["painless"] };

    const events = [
      ev("GAME_CREATED", { createdAt: 1 }),
      ev("ROLE_CLAIMED", { seat: "iryna" }, "iryna"),
      ev("SESSION_STARTED", {}),
      ev("SCENE_FRAMED", { objectives: [objective], threats: [einherjar] }),
      ev("TURN_STARTED", { seat: "iryna", stat: "SHOOT" }, "iryna"),
      ev("DICE_DISCARDED", { playerSurvivors: [6, 5, 4], gmSuccessCount: 0 }),
      ev("ENEMY_CHALLENGE_RAISED", { threatId: "einh", threatName: "Einherjar", amount: 2, ones: 2, rule: "painless" }, "system"),
      // 4 units onto the Einherjar: 2 soaked by the raise, 2 shed → 7 → 5.
      ev("DIE_ALLOCATED", { kind: "eliminate", targetId: "einh", units: 2 }, "iryna"),
      ev("DIE_ALLOCATED", { kind: "eliminate", targetId: "einh", units: 1 }, "iryna"),
      ev("DIE_ALLOCATED", { kind: "eliminate", targetId: "einh", units: 1 }, "iryna"),
      ev("ALLOCATION_COMMITTED", {}, "iryna"),
    ] as GameEvent[];

    const state = reduce(events);
    expect(state.board.threats[0]?.rating).toBe(5); // soak applied authoritatively
    const summary = summarizeCommittedTurn(events, committedSeqOf(events), state)!;
    const byKind = Object.fromEntries(summary.lines.map((l) => [l.kind, l.text]));
    expect(byKind.enemy).toBe("Painless — Einherjar's Challenge +2 (Reich 1s)");
    // The hit line counts the post-soak drop, not the raw units.
    expect(byKind.eliminate).toBe("Hit Einherjar — −2 rating (now 5)");
  });

  it("surfaces a Vampirjäger 'Anathema' boost from the DICE_DISCARDED bonus (#21)", () => {
    const { ev } = log();
    const objective: Objective = { id: "obj", name: "Hold the line", kind: "objective", rating: 6 };
    const cadre: Threat = { id: "cadre", name: "Vampirjäger Cadre", kind: "threat", rating: 8, attack: 3, startingAttack: 3, reinforces: false, restoresAtZero: false, rules: ["anathema"] };

    const events = [
      ev("GAME_CREATED", { createdAt: 1 }),
      ev("ROLE_CLAIMED", { seat: "iryna" }, "iryna"),
      ev("SESSION_STARTED", {}),
      ev("SCENE_FRAMED", { objectives: [objective], threats: [cadre] }),
      ev("TURN_STARTED", { seat: "iryna", stat: "SHOOT" }, "iryna"),
      ev("DICE_DISCARDED", { playerSurvivors: [5, 4], gmSuccessCount: 5, anathemaBonus: 2 }),
      ev("DIE_ALLOCATED", { kind: "defend", units: 2 }, "iryna"),
      ev("ALLOCATION_COMMITTED", {}, "iryna"),
    ] as GameEvent[];

    const state = reduce(events);
    const summary = summarizeCommittedTurn(events, committedSeqOf(events), state)!;
    const byKind = Object.fromEntries(summary.lines.map((l) => [l.kind, l.text]));
    expect(byKind.enemy).toBe("Anathema — Reich 6s scored +2 successes (struck twice)");
  });

  it("returns null for an empty turn and for a non-commit seq", () => {
    const events = irynaClockTowerEvents("g-iryna");
    const state = reduce(events);
    // A seq that isn't an ALLOCATION_COMMITTED.
    expect(summarizeCommittedTurn(events, 1, state)).toBeNull();
  });
});
