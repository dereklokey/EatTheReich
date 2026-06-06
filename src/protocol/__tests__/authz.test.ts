import { describe, it, expect } from "vitest";
import { authorizeIntent } from "../authz.js";
import type { Intent } from "../messages.js";
import { initialState } from "../../state/init.js";
import type { GameState } from "../../state/types.js";

const base = (): GameState => initialState("g");

const withTurn = (seat: GameState["activeSeat"]): GameState => ({
  ...base(),
  activeSeat: seat,
  currentTurn: seat
    ? { seat, phase: "DECLARE", engagedThreatIds: [], tags: [], allocations: [], challengeConsumed: {} }
    : null,
});

describe("authorizeIntent — GM", () => {
  it("may do anything", () => {
    const s = base();
    const intents: Intent[] = [
      { kind: "frame_scene", objectives: [], threats: [] },
      { kind: "end_round" },
      { kind: "change_blood", seat: "iryna", delta: 1 },
      { kind: "release_seat", seat: "nicole" },
      { kind: "start_turn", seat: "flint", stat: "SHOOT", engagedThreatIds: [] },
      { kind: "delete_game" },
    ];
    for (const i of intents) expect(authorizeIntent(s, "gm", i).ok).toBe(true);
  });
});

describe("authorizeIntent — finish & delete game (§3A)", () => {
  it("is GM-only", () => {
    const s = base();
    expect(authorizeIntent(s, "gm", { kind: "delete_game" }).ok).toBe(true);
    expect(authorizeIntent(s, "iryna", { kind: "delete_game" }).ok).toBe(false);
    expect(authorizeIntent(s, null, { kind: "delete_game" }).ok).toBe(false);
  });
});

describe("authorizeIntent — un-seated (lobby / spectator)", () => {
  const s = base();
  it("may create, claim, and use safety tools", () => {
    expect(authorizeIntent(s, null, { kind: "create_game" }).ok).toBe(true);
    expect(authorizeIntent(s, null, { kind: "claim_seat", seat: "iryna" }).ok).toBe(true);
    expect(authorizeIntent(s, null, { kind: "raise_xcard" }).ok).toBe(true);
    expect(authorizeIntent(s, null, { kind: "traffic_signal", color: "red" }).ok).toBe(true);
  });

  it("may not touch the board or any character", () => {
    expect(authorizeIntent(s, null, { kind: "frame_scene", objectives: [], threats: [] }).ok).toBe(false);
    expect(authorizeIntent(s, null, { kind: "change_blood", seat: "iryna", delta: 1 }).ok).toBe(false);
  });
});

describe("authorizeIntent — a seated player", () => {
  const s = base();

  it("may act on their own character but not another's", () => {
    expect(authorizeIntent(s, "iryna", { kind: "change_blood", seat: "iryna", delta: 1 }).ok).toBe(true);
    expect(authorizeIntent(s, "iryna", { kind: "use_equipment", seat: "iryna", itemId: "x" }).ok).toBe(true);
    expect(authorizeIntent(s, "iryna", { kind: "restore_equipment", seat: "iryna", itemId: "x" }).ok).toBe(true);
    expect(authorizeIntent(s, "iryna", { kind: "restore_equipment", seat: "nicole", itemId: "x" }).ok).toBe(false);
    expect(authorizeIntent(s, "iryna", { kind: "share_blood", from: "iryna", to: "nicole", amount: 1 }).ok).toBe(true);

    expect(authorizeIntent(s, "iryna", { kind: "change_blood", seat: "nicole", delta: 1 }).ok).toBe(false);
    expect(authorizeIntent(s, "iryna", { kind: "share_blood", from: "nicole", to: "iryna", amount: 1 }).ok).toBe(false);

    // Loot: the owner may activate their own; granting loot is GM-only.
    expect(authorizeIntent(s, "iryna", { kind: "loot_activate", seat: "iryna", itemId: "x" }).ok).toBe(true);
    expect(authorizeIntent(s, "iryna", { kind: "loot_activate", seat: "nicole", itemId: "x" }).ok).toBe(false);
    expect(authorizeIntent(s, "iryna", { kind: "loot_add", seat: "iryna", item: { id: "x", name: "X" } }).ok).toBe(false);
  });

  it("may use the safety tools, including recording Lines/Veils", () => {
    expect(authorizeIntent(s, "iryna", { kind: "raise_xcard" }).ok).toBe(true);
    expect(authorizeIntent(s, "iryna", { kind: "traffic_signal", color: "amber" }).ok).toBe(true);
    expect(authorizeIntent(s, "iryna", { kind: "set_safety", lines: ["x"] }).ok).toBe(true);
    // Spectators too.
    expect(authorizeIntent(s, null, { kind: "set_safety", veils: ["y"] }).ok).toBe(true);
  });

  it("may not touch GM-only surfaces", () => {
    expect(authorizeIntent(s, "iryna", { kind: "frame_scene", objectives: [], threats: [] }).ok).toBe(false);
    expect(authorizeIntent(s, "iryna", { kind: "end_round" }).ok).toBe(false);
    expect(authorizeIntent(s, "iryna", { kind: "release_seat", seat: "nicole" }).ok).toBe(false);
    expect(authorizeIntent(s, "iryna", { kind: "add_threat", threat: { id: "t", name: "n", kind: "threat", rating: 1, attack: 1, startingAttack: 1, reinforces: false, restoresAtZero: false } }).ok).toBe(false);
  });

  it("may not claim a second seat", () => {
    expect(authorizeIntent(s, "iryna", { kind: "claim_seat", seat: "nicole" }).ok).toBe(false);
  });

  it("may drive only their own turn", () => {
    const irynaTurn = withTurn("iryna");
    expect(authorizeIntent(irynaTurn, "iryna", { kind: "roll", playerPoolDice: 5 }).ok).toBe(true);
    expect(authorizeIntent(irynaTurn, "iryna", { kind: "add_bonus_dice", count: 1 }).ok).toBe(true);
    expect(authorizeIntent(irynaTurn, "iryna", { kind: "resolve_injury" }).ok).toBe(true);
    expect(authorizeIntent(irynaTurn, "iryna", { kind: "commit" }).ok).toBe(true);
    // Not iryna's turn → denied.
    expect(authorizeIntent(irynaTurn, "nicole", { kind: "roll", playerPoolDice: 5 }).ok).toBe(false);
    // No turn in progress → denied.
    expect(authorizeIntent(s, "iryna", { kind: "commit" }).ok).toBe(false);
  });
});
