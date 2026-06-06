import type { GameState, CharacterRuntime, BoardSnapshot, TurnState } from "./types.js";
import { initialState } from "./init.js";
import type { GameEvent, CharId } from "../events/types.js";
import type { Allocation, AllocationAccumulator } from "../engine/allocate.js";
import { applyOneAllocation, clampBlood } from "../engine/allocate.js";
import { TURN_PHASES, addBonusDice } from "../engine/index.js";
import type { DieFace } from "../domain/types.js";
import type { PlayerDie } from "../engine/dice.js";
import { CHARACTERS_BY_ID } from "../data/characters.js";

/** Max uses for an item id, from the sheet equipment or earned loot (undefined = untracked). */
const maxUses = (seat: CharId, itemId: string, c: CharacterRuntime): number | undefined =>
  (CHARACTERS_BY_ID[seat]?.equipment.find((e) => e.id === itemId) ?? c.loot.find((l) => l.id === itemId))?.uses;

/**
 * The reducer (CLAUDE.md §3.1): `state = reduce(events)`. Pure — every case returns
 * a new state without mutating the input. The server computes results (rolls,
 * reinforcement values) before emitting events, so the reducer never needs a dice
 * roller and replay is deterministic.
 */

const updateChar = (
  s: GameState,
  id: CharId,
  fn: (c: CharacterRuntime) => CharacterRuntime,
): GameState => ({
  ...s,
  characters: { ...s.characters, [id]: fn(s.characters[id]) },
});

const withBoard = (s: GameState, board: BoardSnapshot): GameState => ({ ...s, board });

const withTurn = (s: GameState, turn: TurnState | null): GameState => ({ ...s, currentTurn: turn });

const survivorsFromFaces = (faces: DieFace[]): PlayerDie[] =>
  faces.map((face) =>
    face === 6
      ? { face, kind: "crit", units: 2 }
      : { face, kind: "success", units: 1 },
  );

/** Apply one event to the state, returning a new state. */
export function applyEvent(state: GameState, e: GameEvent): GameState {
  const s = { ...state, seq: e.seq };

  switch (e.type) {
    case "GAME_CREATED":
      return { ...s, createdAt: e.payload.createdAt };

    case "PLAYER_JOINED":
      return s; // presence-adjacent; no durable state change

    case "ROLE_CLAIMED": {
      const seatPatch = { claimed: true, ...(e.payload.seatTokenHash ? { seatTokenHash: e.payload.seatTokenHash } : {}) };
      return { ...s, seats: { ...s.seats, [e.payload.seat]: seatPatch } };
    }
    case "SEAT_RELEASED":
      return { ...s, seats: { ...s.seats, [e.payload.seat]: { claimed: false } } };

    case "SESSION_STARTED": {
      const characters = Object.fromEntries(
        Object.entries(s.characters).map(([id, c]) => [id, { ...c, flashbackUsedThisSession: false }]),
      ) as Record<CharId, CharacterRuntime>;
      return { ...s, lifecycle: "playing", session: { number: s.session.number + 1, active: true }, characters };
    }
    case "SESSION_ENDED":
      return { ...s, session: { ...s.session, active: false } };

    case "SAFETY_SET":
      return {
        ...s,
        safety: {
          ...s.safety,
          ...(e.payload.lines ? { lines: e.payload.lines } : {}),
          ...(e.payload.veils ? { veils: e.payload.veils } : {}),
          ...(e.payload.calibration ? { calibration: e.payload.calibration } : {}),
        },
      };
    case "XCARD_RAISED":
      return { ...s, safety: { ...s.safety, xcardRaised: true } };
    case "XCARD_CLEARED":
      return { ...s, safety: { ...s.safety, xcardRaised: false } };
    case "TRAFFIC_SIGNAL":
      return { ...s, safety: { ...s.safety, traffic: e.payload.color } };

    case "SCENE_FRAMED":
      return {
        ...s,
        lifecycle: "playing",
        board: {
          objectives: e.payload.objectives,
          threats: e.payload.threats,
          secondaryObjectives: e.payload.secondaryObjectives ?? [],
          scene: e.payload.scene ?? null,
          ...(e.payload.locationId ? { locationId: e.payload.locationId } : {}),
        },
      };
    case "SCENE_SET":
      return withBoard(s, {
        ...s.board,
        scene: e.payload.title.trim() ? { title: e.payload.title.trim(), ...(e.payload.note?.trim() ? { note: e.payload.note.trim() } : {}) } : null,
      });
    case "OBJECTIVE_ADDED":
      return withBoard(s, { ...s.board, objectives: [...s.board.objectives, e.payload.objective] });
    case "OBJECTIVE_UPDATED":
      return withBoard(s, {
        ...s.board,
        objectives: s.board.objectives.map((o) => (o.id === e.payload.id ? { ...o, ...e.payload.patch } : o)),
      });
    case "OBJECTIVE_COMPLETED":
      return withBoard(s, {
        ...s.board,
        objectives: s.board.objectives.map((o) => (o.id === e.payload.id ? { ...o, rating: 0 } : o)),
      });
    case "THREAT_ADDED":
      return withBoard(s, { ...s.board, threats: [...s.board.threats, e.payload.threat] });
    case "THREAT_UPDATED":
      return withBoard(s, {
        ...s.board,
        threats: s.board.threats.map((t) => (t.id === e.payload.id ? { ...t, ...e.payload.patch } : t)),
      });
    case "THREAT_REMOVED":
      return withBoard(s, { ...s.board, threats: s.board.threats.filter((t) => t.id !== e.payload.id) });

    case "TURN_STARTED":
      return {
        ...s,
        activeSeat: e.payload.seat,
        currentTurn: {
          seat: e.payload.seat,
          phase: "DECLARE",
          ...(e.payload.stat ? { stat: e.payload.stat } : {}),
          engagedThreatIds: e.payload.engagedThreatIds ?? [],
          tags: e.payload.tags ?? [],
          allocations: [],
          challengeConsumed: {},
        },
      };
    case "TURN_CANCELLED":
      // Abort: drop the in-progress turn. NOT added to actedThisRound — the
      // character can still take their turn this round (unlike ALLOCATION_COMMITTED).
      return { ...s, currentTurn: null, activeSeat: null };

    case "POOL_BUILT": {
      if (!s.currentTurn) return s;
      const turn =
        e.payload.who === "player"
          ? { ...s.currentTurn, playerPool: { total: e.payload.dice, sources: e.payload.sources ?? [] }, phase: "BUILD_PLAYER_POOL" as const }
          : { ...s.currentTurn, gmPoolSize: e.payload.dice, phase: "BUILD_GM_POOL" as const };
      return withTurn(s, turn);
    }
    case "DICE_ROLLED": {
      if (!s.currentTurn) return s;
      const turn =
        e.payload.who === "player"
          ? { ...s.currentTurn, playerDice: e.payload.results, phase: "ROLL" as const }
          : { ...s.currentTurn, gmDice: e.payload.results, phase: "ROLL" as const };
      return withTurn(s, turn);
    }
    case "PASSIVE_APPLIED": {
      // Blood gains (e.g. Corpse Eater) apply to the active character; GM-success
      // reductions are reflected by the server in the subsequent DICE_DISCARDED.
      if (e.payload.bloodDelta && s.activeSeat) {
        return updateChar(s, s.activeSeat, (c) => ({ ...c, blood: clampBlood(c.blood + (e.payload.bloodDelta ?? 0)) }));
      }
      return s;
    }
    case "DICE_DISCARDED": {
      if (!s.currentTurn) return s;
      return withTurn(s, {
        ...s.currentTurn,
        phase: "DISCARD",
        ...(e.payload.playerSurvivors ? { survivors: survivorsFromFaces(e.payload.playerSurvivors) } : {}),
        ...(e.payload.gmSuccessCount !== undefined
          ? { gmSuccessCount: e.payload.gmSuccessCount, gmDiceRemaining: e.payload.gmSuccessCount }
          : {}),
      });
    }
    case "BONUS_DICE_ROLLED": {
      // The pool isn't frozen at roll time (RULES §4): append the new survivors to the
      // tray and record the rolled dice + pool source so replay stays faithful.
      if (!s.currentTurn) return s;
      const turn = s.currentTurn;
      return withTurn(s, {
        ...turn,
        playerDice: [...(turn.playerDice ?? []), ...e.payload.results],
        survivors: [...(turn.survivors ?? []), ...survivorsFromFaces(e.payload.survivors)],
        ...(turn.playerPool
          ? { playerPool: { total: turn.playerPool.total + e.payload.count, sources: [...turn.playerPool.sources, addBonusDice(e.payload.label ?? "bonus", e.payload.count)] } }
          : {}),
      });
    }
    case "DIE_ALLOCATED": {
      if (!s.currentTurn) return s;
      const turn = s.currentTurn;
      const alloc: Allocation = {
        kind: e.payload.kind,
        units: e.payload.units,
        ...(e.payload.targetId ? { targetId: e.payload.targetId } : {}),
        ...(e.payload.specialId ? { specialId: e.payload.specialId } : {}),
      };
      const acc: AllocationAccumulator = {
        board: { objectives: s.board.objectives, threats: s.board.threats },
        gmDiceRemaining: turn.gmDiceRemaining ?? 0,
        bloodGained: 0,
        challengeConsumed: turn.challengeConsumed,
        specialsActivated: [],
      };
      const next = applyOneAllocation(acc, alloc);
      let out: GameState = withBoard(s, {
        ...s.board,
        objectives: next.board.objectives,
        threats: next.board.threats,
      });
      out = withTurn(out, {
        ...turn,
        phase: "ALLOCATE",
        allocations: [...turn.allocations, alloc],
        challengeConsumed: next.challengeConsumed,
        gmDiceRemaining: next.gmDiceRemaining,
      });
      if (next.bloodGained > 0) {
        out = updateChar(out, turn.seat, (c) => ({ ...c, blood: clampBlood(c.blood + next.bloodGained) }));
      }
      return out;
    }
    case "ALLOCATION_COMMITTED": {
      const seat = s.currentTurn?.seat ?? s.activeSeat;
      const acted = seat && !s.actedThisRound.includes(seat) ? [...s.actedThisRound, seat] : s.actedThisRound;
      return { ...s, currentTurn: null, activeSeat: null, actedThisRound: acted };
    }

    case "INJURY_PENDING":
      // Park the rolled-but-unapplied injury on the turn (RULES §4 INJURY_CHECK). The
      // box isn't marked until INJURY_MARKED/DOWNED/DEATH_LAST_STAND fire on resolve —
      // this just opens the reveal/reaction window without closing the turn.
      if (!s.currentTurn) return s;
      return withTurn(s, {
        ...s.currentTurn,
        phase: "INJURY_CHECK",
        pendingInjury: { face: e.payload.face, outcome: e.payload.outcome },
      });
    case "INJURY_MARKED":
      return updateChar(s, e.payload.seat, (c) => {
        const injuries = [...c.injuries] as CharacterRuntime["injuries"];
        injuries[e.payload.category] = Math.max(injuries[e.payload.category], e.payload.box);
        const triggeredPenalties =
          e.payload.box === 2 && e.payload.penalty ? [...c.triggeredPenalties, e.payload.penalty] : c.triggeredPenalties;
        return { ...c, injuries, triggeredPenalties };
      });
    case "DOWNED":
      return updateChar(s, e.payload.seat, (c) => {
        const injuries = [...c.injuries] as CharacterRuntime["injuries"];
        injuries[e.payload.category] = 2;
        return { ...c, injuries, downed: true };
      });
    case "HEALED":
      return updateChar(s, e.payload.seat, (c) => {
        const injuries = [...c.injuries] as CharacterRuntime["injuries"];
        injuries[e.payload.category] = Math.max(0, e.payload.box - 1);
        return { ...c, injuries, downed: injuries.some((n) => n === 2) ? c.downed : false };
      });
    case "DEATH_LAST_STAND": {
      // All 6 boxes marked → open the Last Stand (RULES §5). NOT dead yet: the vampire
      // gets one final 8d6 first. Replaces the normal turn with a Last Stand turn.
      const marked = updateChar(s, e.payload.seat, (c) => ({ ...c, injuries: [2, 2, 2] as CharacterRuntime["injuries"] }));
      return {
        ...marked,
        activeSeat: e.payload.seat,
        currentTurn: {
          seat: e.payload.seat,
          phase: "DONE",
          lastStand: true,
          engagedThreatIds: [],
          tags: [],
          allocations: [],
          challengeConsumed: {},
          gmDiceRemaining: 0,
        },
      };
    }
    case "LAST_STAND_ROLLED":
      if (!s.currentTurn?.lastStand) return s;
      return withTurn(s, {
        ...s.currentTurn,
        playerDice: e.payload.dice,
        survivors: survivorsFromFaces(e.payload.dice), // every die counts — no discard
      });
    case "LAST_STAND_ENDED":
      return {
        ...updateChar(s, e.payload.seat, (c) => ({ ...c, dead: true })),
        currentTurn: null,
        activeSeat: null,
      };
    case "BLOOD_CHANGED":
      return updateChar(s, e.payload.seat, (c) => ({ ...c, blood: clampBlood(c.blood + e.payload.delta) }));
    case "BLOOD_SHARED": {
      const out = updateChar(s, e.payload.from, (c) => ({ ...c, blood: clampBlood(c.blood - e.payload.amount) }));
      return updateChar(out, e.payload.to, (c) => ({ ...c, blood: clampBlood(c.blood + e.payload.amount) }));
    }

    case "EQUIPMENT_USED":
      return updateChar(s, e.payload.seat, (c) => {
        if (c.equipmentUses[e.payload.itemId] === undefined) return c;
        return { ...c, equipmentUses: { ...c.equipmentUses, [e.payload.itemId]: Math.max(0, c.equipmentUses[e.payload.itemId]! - 1) } };
      });
    case "EQUIPMENT_RESTORED":
      return updateChar(s, e.payload.seat, (c) => {
        const cur = c.equipmentUses[e.payload.itemId];
        const max = maxUses(e.payload.seat, e.payload.itemId, c);
        if (cur === undefined || max === undefined) return c;
        return { ...c, equipmentUses: { ...c.equipmentUses, [e.payload.itemId]: Math.min(max, cur + 1) } };
      });
    case "LOOT_ADDED":
      return updateChar(s, e.payload.seat, (c) => ({
        ...c,
        loot: [...c.loot, e.payload.item],
        ...(e.payload.item.uses !== undefined ? { equipmentUses: { ...c.equipmentUses, [e.payload.item.id]: e.payload.item.uses } } : {}),
      }));
    case "LOOT_ACTIVATED":
      return updateChar(s, e.payload.seat, (c) => ({ ...c, activeLootSlot: e.payload.itemId }));
    case "ADVANCE_UNLOCKED":
      return updateChar(s, e.payload.seat, (c) =>
        c.unlockedAdvances.includes(e.payload.advanceId) ? c : { ...c, unlockedAdvances: [...c.unlockedAdvances, e.payload.advanceId] },
      );

    case "SECONDARY_OBJECTIVE_ADDED":
      return withBoard(s, { ...s.board, secondaryObjectives: [...s.board.secondaryObjectives, e.payload.objective] });
    case "SECONDARY_OBJECTIVE_UPDATED":
      return withBoard(s, {
        ...s.board,
        secondaryObjectives: s.board.secondaryObjectives.map((o) => (o.id === e.payload.id ? { ...o, ...e.payload.patch } : o)),
      });
    case "SECONDARY_OBJECTIVE_COMPLETED":
      return withBoard(s, {
        ...s.board,
        secondaryObjectives: s.board.secondaryObjectives.map((o) =>
          o.id === e.payload.id ? { ...o, rating: 0, ...(e.payload.rewardChoice ? { rewardChoice: e.payload.rewardChoice } : {}) } : o,
        ),
      });
    case "SECONDARY_OBJECTIVE_REMOVED":
      return withBoard(s, { ...s.board, secondaryObjectives: s.board.secondaryObjectives.filter((o) => o.id !== e.payload.id) });

    case "FLASHBACK_TRIGGERED":
      return updateChar(s, e.payload.seat, (c) => ({ ...c, flashbackUsedThisSession: true }));
    case "ROUND_ENDED":
      return { ...s, round: s.round + 1, actedThisRound: [] };
    case "REINFORCEMENTS_APPLIED":
      return withBoard(s, { ...s.board, threats: e.payload.threats });

    case "GM_OVERRIDE":
      return withBoard(s, {
        ...s.board,
        ...(e.payload.patch?.objectives ? { objectives: e.payload.patch.objectives } : {}),
        ...(e.payload.patch?.threats ? { threats: e.payload.patch.threats } : {}),
      });

    default:
      return assertNever(e);
  }
}

function assertNever(e: never): never {
  throw new Error(`Unhandled event: ${JSON.stringify(e)}`);
}

/** Fold a full (ordered) event log into state. Optionally start from a snapshot. */
export function reduce(events: readonly GameEvent[], base?: GameState): GameState {
  const start = base ?? initialState(events[0]?.gameId ?? "unknown");
  return events.reduce(applyEvent, start);
}

// Re-export so callers can build the phase-ordered pipeline view if needed.
export { TURN_PHASES };
