import { describe, it, expect } from "vitest";
import { STATS } from "../../domain/types.js";
import { CHARACTERS, CHARACTERS_BY_ID, IRYNA, FLINT } from "../characters.js";
import {
  stahlsoldat,
  rustWitch,
  damonenblut,
  werhund,
  sniperTeam,
  infantrySquad,
  einherjar,
} from "../threats.js";
import type { ActionContext } from "../../domain/types.js";
import { sequenceRoller } from "../../domain/dice.js";
import { reinforce, availableCritSpecials } from "../../engine/index.js";
import { CHUCK, ASTRID, NICOLE } from "../characters.js";

describe("character catalog integrity", () => {
  it("has all six pregens, each fully statted (no PENDING zeros)", () => {
    expect(CHARACTERS).toHaveLength(6);
    for (const c of CHARACTERS) {
      for (const s of STATS) {
        expect(c.stats[s], `${c.name}.${s}`).toBeGreaterThan(0);
      }
    }
  });

  it("each has 3 abilities (Flint has 4) and 3 advances", () => {
    for (const c of CHARACTERS) {
      expect(c.advances.length, `${c.name} advances`).toBe(3);
      expect(c.abilities.length, `${c.name} abilities`).toBeGreaterThanOrEqual(3);
    }
    expect(FLINT.abilities).toHaveLength(4);
  });

  it("each injury category has 2 boxes; the 2nd carries the penalty", () => {
    for (const c of CHARACTERS) {
      expect(c.injuries).toHaveLength(3);
      for (const cat of c.injuries) {
        expect(cat.boxes).toHaveLength(2);
        expect(cat.boxes[1].penalty, `${c.name} penalty`).toBeTruthy();
      }
    }
  });

  it("Iryna matches the rulebook sheet (golden-test anchor)", () => {
    expect(IRYNA.stats).toMatchObject({ SHOOT: 3, CON: 4, SNEAK: 1, BRAWL: 2, TERRIFY: 3 });
    const runes = IRYNA.equipment.find((e) => e.id === "iryna-runes")!;
    expect(runes.bonus).toEqual({ tag: "concealed", plus: 2 });
    expect(runes.uses).toBe(2);
  });

  it("Nicole's weapons carry distinct Scavenger slots 1–6", () => {
    const slots = NICOLE.equipment.map((e) => e.scavengerSlot).filter((n) => n !== undefined).sort();
    expect(slots).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("indexes by id", () => {
    expect(CHARACTERS_BY_ID["cosgrave"]?.name).toBe("Cosgrave");
  });

  it("effect-only actives are flagged addsDie:false (no pool die); weapon-style actives are not", () => {
    const noDie = ["iryna-hells-fire", "iryna-enervation", "iryna-mantle", "astrid-tethered-phantom", "flint-hellish-screech"];
    const powerById = new Map(CHARACTERS.flatMap((c) => [...c.abilities, ...c.advances]).map((p) => [p.id, p]));
    for (const id of noDie) expect(powerById.get(id)?.addsDie, id).toBe(false);
    // A die-adding ability (Iryna's Dark Glamour) leaves the flag unset (defaults true).
    expect(powerById.get("iryna-dark-glamour")?.addsDie).toBeUndefined();
    // No active ability is both no-die AND carries a roll bonus (would be contradictory).
    for (const p of powerById.values()) {
      if (p.addsDie === false) expect(p.bonus, p.id).toBeUndefined();
    }
  });

  it("reactive items are flagged addsDie:false; weapons are not", () => {
    const eqById = new Map(CHARACTERS.flatMap((c) => c.equipment).map((e) => [e.id, e]));
    expect(eqById.get("chuck-cowboy-hat")?.addsDie).toBe(false);
    expect(eqById.get("iryna-cigarettes")?.addsDie).toBe(false);
    expect(eqById.get("iryna-rifle")?.addsDie).toBeUndefined(); // a weapon: still a pool die
  });
});

describe("crit-SPECIAL availability against real sheets", () => {
  const anyCtx: ActionContext = { stat: "BRAWL", targetKind: "threat", solo: true, engagedThreatIds: [] };

  it("Astrid's Apex Predator (unconditional crit) is always offered", () => {
    const ids = availableCritSpecials(ASTRID, anyCtx).map((s) => s.id);
    expect(ids).toContain("astrid-apex-predator");
    expect(ids).toContain("astrid-unnatural-endurance");
  });

  it("Flint's Ravenous needs the 'melee' tag", () => {
    expect(availableCritSpecials(FLINT, anyCtx).map((s) => s.id)).not.toContain("flint-ravenous");
    expect(
      availableCritSpecials(FLINT, { ...anyCtx, tags: ["melee"] }).map((s) => s.id),
    ).toContain("flint-ravenous");
  });

  it("Chuck's Elbow Grease is advance-gated AND condition-gated", () => {
    const fixSolo: ActionContext = { stat: "FIX", targetKind: "objective", solo: true, engagedThreatIds: [] };
    // Locked: not offered even in the right context.
    expect(availableCritSpecials(CHUCK, fixSolo).map((s) => s.id)).not.toContain("chuck-elbow-grease");
    // Unlocked + right context: offered.
    expect(
      availableCritSpecials(CHUCK, fixSolo, new Set(["chuck-elbow-grease"])).map((s) => s.id),
    ).toContain("chuck-elbow-grease");
  });
});

describe("Übermenschen & Solo reinforcement behaviour (rulebook p38/p61)", () => {
  it("standard Übermenschen do not reinforce and die at 0", () => {
    for (const make of [rustWitch, damonenblut, werhund]) {
      const t = make();
      expect(t.reinforces).toBe(false);
      expect(t.restoresAtZero).toBe(false);
    }
    expect(werhund().unlowerableChallenge).toBe(true);
    expect(rustWitch().discardThreshold).toBe(4); // Aura of Misfortune
    expect(damonenblut().rating).toBe(12);
  });

  it("Stahlsoldat is the hybrid: escalates while alive, but removed at 0", () => {
    const s = stahlsoldat();
    expect(s.reinforces).toBe(true);
    expect(s.restoresAtZero).toBe(false);

    // Alive at end of round → Attack escalates +1 (4 → 5).
    const alive = reinforce({
      threats: [s],
      reducedToZeroThisRound: new Set(),
      zeroSuccessThisRound: new Set(),
      roller: sequenceRoller([]),
    });
    expect(alive.threats[0]?.attack).toBe(5);

    // Reduced to 0 → removed permanently (not restored).
    const dead = reinforce({
      threats: [{ ...s, rating: 0, attack: 0 }],
      reducedToZeroThisRound: new Set([s.id]),
      zeroSuccessThisRound: new Set(),
      roller: sequenceRoller([]),
    });
    expect(dead.threats).toHaveLength(0);
    expect(dead.log[0]?.removed).toBe(true);
  });

  it("a Solo common enemy (Sniper Team) does not escalate while alive", () => {
    const sniper = sniperTeam();
    const r = reinforce({
      threats: [sniper],
      reducedToZeroThisRound: new Set(),
      zeroSuccessThisRound: new Set(),
      roller: sequenceRoller([]),
    });
    expect(r.threats[0]?.attack).toBe(sniper.attack); // unchanged
  });

  it("a standard threat (Infantry Squad) restores 1d6 + half-Attack at 0", () => {
    const squad = infantrySquad(); // rating 6, attack 3
    const r = reinforce({
      threats: [{ ...squad, rating: 0, attack: 0 }],
      reducedToZeroThisRound: new Set([squad.id]),
      zeroSuccessThisRound: new Set(),
      roller: sequenceRoller([5]),
    });
    expect(r.threats[0]?.rating).toBe(5); // 0 + 1d6(5)
    expect(r.threats[0]?.attack).toBe(1); // floor(3/2)
  });

  it("Einherjar carries its painless/bloodless rule keys", () => {
    expect(einherjar().rules).toEqual(["painless", "bloodless"]);
  });
});
