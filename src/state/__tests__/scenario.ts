import { makeEvent } from "../../events/types.js";
import type { GameEvent, EventType, EventPayloads, Actor } from "../../events/types.js";
import type { Objective, Threat } from "../../domain/types.js";

/**
 * The RULES §12-A "Iryna clock-tower turn" expressed as a full event log — the
 * integration fixture that ties the engine (step 2) to event sourcing (step 3).
 * Reducing it must reproduce the golden end state: Objective 6 → 3, no Injury.
 */
export function irynaClockTowerEvents(gameId: string): GameEvent[] {
  let seq = 0;
  const ev = <T extends EventType>(type: T, payload: EventPayloads[T], actor: Actor = "gm"): GameEvent =>
    makeEvent({ id: `${gameId}-${++seq}`, gameId, seq, actor, ts: seq * 1000 }, type, payload) as GameEvent;

  const objective: Objective = {
    id: "obj-take-cover",
    name: "Take cover inside the museum",
    kind: "objective",
    rating: 6,
  };
  const threat: Threat = {
    id: "thr-nazi-squad",
    name: "Nazi Squad",
    kind: "threat",
    rating: 4,
    attack: 3,
    startingAttack: 3,
    reinforces: true,
    restoresAtZero: true,
  };

  return [
    ev("GAME_CREATED", { createdAt: 1000 }),
    ev("ROLE_CLAIMED", { seat: "iryna", seatTokenHash: "hash-iryna" }, "iryna"),
    ev("SESSION_STARTED", {}),
    ev("SCENE_FRAMED", { objectives: [objective], threats: [threat] }),
    ev(
      "TURN_STARTED",
      { seat: "iryna", stat: "SHOOT", tags: ["ranged weapon", "elevated position"] },
      "iryna",
    ),
    ev(
      "POOL_BUILT",
      {
        who: "player",
        dice: 6,
        sources: [
          { label: "SHOOT", dice: 3 },
          { label: "rifle", dice: 1 },
          { label: "runes", dice: 1 },
          { label: "+rifle bonus", dice: 1 },
        ],
      },
      "iryna",
    ),
    ev("POOL_BUILT", { who: "gm", dice: 3 }),
    ev("DICE_ROLLED", { who: "player", results: [6, 5, 4, 2, 2, 1] }, "iryna"),
    ev("DICE_ROLLED", { who: "gm", results: [6, 4, 1] }),
    ev("DICE_DISCARDED", { playerSurvivors: [6, 5, 4], gmSuccessCount: 2 }),
    ev("DIE_ALLOCATED", { kind: "advance", targetId: objective.id, units: 1, detail: "clean through the forehead" }, "iryna"),
    ev("DIE_ALLOCATED", { kind: "advance", targetId: objective.id, units: 1, detail: "shoot out the spotlight" }, "iryna"),
    ev("DIE_ALLOCATED", { kind: "defend", units: 2, detail: "knock the tower door off its hinges" }, "iryna"),
    ev("EQUIPMENT_USED", { seat: "iryna", itemId: "iryna-runes" }, "iryna"),
    // Mid-allocation: Explosive Runes (++concealed) now satisfied → bonus 4,2; the 4 lands.
    ev("DIE_ALLOCATED", { kind: "advance", targetId: objective.id, units: 1, detail: "hidden runes detonate" }, "iryna"),
    ev("ALLOCATION_COMMITTED", {}, "iryna"),
  ];
}
