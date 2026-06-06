import type { Objective, Threat, SecondaryObjective } from "@shared/domain/types.js";
import type { Location } from "@shared/data/locations.js";
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
 * Resolve one free-form enemy line (e.g. "Police Patrol x2", "Nazi officers …
 * (same stats as Police Patrol)") into one or more Threats. Falls back to a generic
 * editable Threat when nothing matches — the GM tunes it on the board.
 */
function resolveEnemies(line: string): Threat[] {
  const count = /x\s*(\d+)/i.exec(line);
  const n = count ? Math.max(1, Number(count[1])) : 1;
  const lower = line.toLowerCase();
  const hit = BY_NAME.find((e) => lower.includes(e.name));
  const out: Threat[] = [];
  for (let i = 0; i < n; i++) {
    out.push(
      hit
        ? hit.make()
        : makeThreat({ id: uuid(), name: line.replace(/\s*\(.*?\)\s*/g, "").replace(/x\s*\d+/i, "").trim() || line, rating: 4, attack: 2 }),
    );
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
    })),
  };
}

export function newObjective(name: string, rating: number, challenge?: number): Objective {
  return { id: uuid(), name, kind: "objective", rating, ...(challenge ? { challenge } : {}) };
}

export function rescueObjective(seatName: string, seat: string): SecondaryObjective {
  return { id: uuid(), name: `Rescue ${seatName}`, kind: "secondary", rating: 4, rescueFor: seat };
}
