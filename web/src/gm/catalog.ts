import type { Objective, Threat, SecondaryObjective } from "@shared/domain/types.js";
import type { Equipment } from "@shared/domain/character.js";
import type { EnemyRef, Location, LootRef } from "@shared/data/locations.js";
import { LOCATIONS } from "@shared/data/locations.js";
import { LOOT_DEFAULT_USES, parseLootBonus } from "@shared/data/rewards.js";
import {
  COMMON_ENEMY_FACTORIES,
  UBERMENSCHEN_FACTORIES,
  makeThreat,
} from "@shared/data/threats.js";

/**
 * GM catalogs + location quick-load (CLAUDE.md §4: "load a location's suggested
 * board"). Everything produced here is a GM default to drop on the board and then
 * edit — ratings, Attack, Challenge are all overridable (CLAUDE.md §0).
 */

const THREAT_FACTORIES = [...COMMON_ENEMY_FACTORIES, ...UBERMENSCHEN_FACTORIES];

/** Pickable threats for "add a Threat", labelled by their canonical name. */
export const THREAT_CATALOG: { label: string; make: () => Threat }[] = THREAT_FACTORIES.map(
  (make) => ({ label: make().name, make }),
);

const uuid = () => crypto.randomUUID();

/** Lowercased name → factory, for best-effort resolution of a location's free-form enemies. */
const BY_NAME = THREAT_FACTORIES.map((make) => ({ name: make().name.toLowerCase(), make }));

/**
 * Resolve one enemy ref (e.g. "Police Patrol x2", "Nazi officers … (same stats as Police
 * Patrol)", or a `{ ref, staged }` object) into one or more Threats. Falls back to a generic
 * editable Threat when nothing matches — the GM tunes it on the board. A `staged` ref loads
 * its Threats OUT of play (`active: false`, issue #12) for the GM to activate when they arrive.
 */
function resolveEnemies(enemy: EnemyRef): Threat[] {
  const line = typeof enemy === "string" ? enemy : enemy.ref;
  const staged = typeof enemy === "string" ? false : enemy.staged;
  const count = /x\s*(\d+)/i.exec(line);
  const n = count ? Math.max(1, Number(count[1])) : 1;
  const lower = line.toLowerCase();
  const hit = BY_NAME.find((e) => lower.includes(e.name));
  const out: Threat[] = [];
  for (let i = 0; i < n; i++) {
    const t = hit
      ? hit.make()
      : makeThreat({ id: uuid(), name: line.replace(/\s*\(.*?\)\s*/g, "").replace(/x\s*\d+/i, "").trim() || line, rating: 4, attack: 2 });
    out.push(staged ? { ...t, active: false } : t);
  }
  return out;
}

export interface LoadedBoard {
  objectives: Objective[];
  threats: Threat[];
  secondaryObjectives: SecondaryObjective[];
}

/** Build a full suggested board from a location's reference data. */
export function loadLocation(loc: Location): LoadedBoard {
  return {
    objectives: loc.objectives.map((o) => ({
      id: uuid(),
      name: o.name,
      kind: "objective",
      rating: o.rating,
      ...(o.challenge !== undefined ? { challenge: o.challenge } : {}),
    })),
    threats: loc.enemies.flatMap(resolveEnemies),
    secondaryObjectives: (loc.secondaryObjectives ?? []).map((s) => ({
      id: uuid(),
      name: s.name,
      kind: "secondary",
      rating: s.rating,
      // Staged by default (issue #15): the GM reveals each as the fiction offers it.
      revealed: false,
      ...(s.rewardEquipment?.length ? { rewardEquipment: s.rewardEquipment } : {}),
    })),
  };
}

export function newObjective(name: string, rating: number, challenge?: number): Objective {
  return { id: uuid(), name, kind: "objective", rating, ...(challenge ? { challenge } : {}) };
}

export function rescueObjective(seatName: string, seat: string): SecondaryObjective {
  return { id: uuid(), name: `Rescue ${seatName}`, kind: "secondary", rating: 4, rescueFor: seat };
}

export function newSecondaryObjective(name: string, rating: number, challenge?: number): SecondaryObjective {
  return { id: uuid(), name, kind: "secondary", rating, ...(challenge ? { challenge } : {}) };
}

/** The loot named across all locations, de-duped — quick-pick suggestions for granting. */
export const LOOT_CATALOG: LootRef[] = (() => {
  const seen = new Set<string>();
  const out: LootRef[] = [];
  for (const loc of LOCATIONS) {
    for (const l of loc.loot ?? []) {
      if (seen.has(l.name)) continue;
      seen.add(l.name);
      out.push(l);
    }
  }
  return out;
})();

/** Build a loot Equipment from GM input: 3 uses, occupies a Loot slot, optional bonus/note (rulebook p39). */
export function newLoot(name: string, bonus?: string, note?: string): Equipment {
  const b = parseLootBonus(bonus);
  return {
    id: `loot-${uuid().slice(0, 8)}`,
    name,
    uses: LOOT_DEFAULT_USES,
    loot: true,
    ...(b ? { bonus: b } : {}),
    ...(note ? { note } : {}),
  };
}

/**
 * Special gear unlocked by a Secondary Objective (rulebook p39): **slot-free**
 * (`loot: false` → never occupies/needs the one active loot slot, always available) and a
 * persistent asset (no use track — a weapons platform isn't a 3-use consumable).
 */
export function newRewardGear(name: string, bonus?: string, note?: string): Equipment {
  const b = parseLootBonus(bonus);
  return {
    id: `gear-${uuid().slice(0, 8)}`,
    name,
    loot: false,
    ...(b ? { bonus: b } : {}),
    ...(note ? { note } : {}),
  };
}
