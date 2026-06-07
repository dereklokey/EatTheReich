import { describe, it, expect } from "vitest";
import {
  SPECIAL_HOOKS,
  HOOK_POINTS,
  HOOK_POINT_INFO,
  hooksAt,
  plannedHooks,
  implementedHooks,
  hookById,
} from "../specialHooks.js";
import { THREAT_RULES } from "../threats.js";
import { CHARACTERS } from "../characters.js";

/**
 * The special-rules catalog is a *contract*: it must stay a complete, drift-free map of
 * the exception surface. These tests fail loudly if a new enemy rule tag, character SPECIAL,
 * passive, or reactive item is added without being catalogued (and given a tracking issue).
 */
describe("special-hooks framework", () => {
  it("has unique ids", () => {
    const ids = SPECIAL_HOOKS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry fires at a known hook point", () => {
    for (const h of SPECIAL_HOOKS) {
      expect(HOOK_POINTS).toContain(h.hook);
      expect(HOOK_POINT_INFO[h.hook]).toBeDefined();
    }
  });

  it("planned entries carry a tracking issue; implemented ones do not", () => {
    for (const h of plannedHooks()) {
      expect(h.issue, `${h.id} is planned but has no issue`).toBeGreaterThan(0);
    }
    for (const h of implementedHooks()) {
      expect(h.issue, `${h.id} is implemented and should not link an issue`).toBeUndefined();
    }
  });

  it("planned + implemented partition the whole catalog", () => {
    expect(plannedHooks().length + implementedHooks().length).toBe(SPECIAL_HOOKS.length);
  });

  it("`select` resolutions name what gets chosen", () => {
    for (const h of SPECIAL_HOOKS) {
      if (h.resolution === "select") {
        expect(h.target, `${h.id} selects but names no target`).toBeDefined();
        expect(h.target).not.toBe("none");
      }
    }
  });

  it("hooksAt partitions by hook point", () => {
    const total = HOOK_POINTS.reduce((n, p) => n + hooksAt(p).length, 0);
    expect(total).toBe(SPECIAL_HOOKS.length);
  });

  // ── Coverage: every enemy rule tag is catalogued ────────────────────────────
  it("covers every THREAT_RULES tag", () => {
    const taggedEnemyHooks = new Set(
      SPECIAL_HOOKS.flatMap((h) => (h.source.kind === "enemy" ? [h.source.tag] : [])),
    );
    for (const tag of Object.values(THREAT_RULES)) {
      expect(taggedEnemyHooks.has(tag), `enemy rule "${tag}" is not catalogued`).toBe(true);
    }
  });

  // ── Coverage: every character SPECIAL & passive is catalogued ────────────────
  it("covers every character SPECIAL and passive power", () => {
    const cataloguedPowerIds = new Set(
      SPECIAL_HOOKS.flatMap((h) =>
        h.source.kind === "ability" || h.source.kind === "advance" ? h.source.powerIds : [],
      ),
    );
    for (const c of CHARACTERS) {
      for (const p of [...c.abilities, ...c.advances]) {
        if (p.mechanic === "special" || p.mechanic === "passive") {
          expect(
            cataloguedPowerIds.has(p.id),
            `${c.name}'s ${p.mechanic} "${p.id}" is not catalogued`,
          ).toBe(true);
        }
      }
    }
  });

  // ── Integrity: every referenced power/item id actually exists ────────────────
  it("references only real power and item ids", () => {
    const realPowerIds = new Set(CHARACTERS.flatMap((c) => [...c.abilities, ...c.advances].map((p) => p.id)));
    const realItemIds = new Set(CHARACTERS.flatMap((c) => c.equipment.map((e) => e.id)));
    for (const h of SPECIAL_HOOKS) {
      if (h.source.kind === "ability" || h.source.kind === "advance") {
        for (const id of h.source.powerIds) {
          expect(realPowerIds.has(id), `${h.id} references unknown power "${id}"`).toBe(true);
        }
      }
      if (h.source.kind === "item") {
        for (const id of h.source.itemIds) {
          expect(realItemIds.has(id), `${h.id} references unknown item "${id}"`).toBe(true);
        }
      }
    }
  });

  // ── Coverage: every reactive item is catalogued ─────────────────────────────
  it("covers every reactive economy item", () => {
    const cataloguedItemIds = new Set(
      SPECIAL_HOOKS.flatMap((h) => (h.source.kind === "item" ? h.source.itemIds : [])),
    );
    for (const c of CHARACTERS) {
      for (const e of c.equipment) {
        if (e.reactive) {
          expect(cataloguedItemIds.has(e.id), `${c.name}'s reactive item "${e.id}" is not catalogued`).toBe(true);
        }
      }
    }
  });

  it("hookById round-trips", () => {
    for (const h of SPECIAL_HOOKS) {
      expect(hookById(h.id)).toBe(h);
    }
  });
});
