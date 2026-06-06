import type { GameState } from "../state/types.js";
import type {
  Actor,
  CharId,
  EventPayloads,
  EventType,
} from "../events/types.js";
import type { DiceRoller } from "../domain/dice.js";
import type { Intent } from "./messages.js";
import {
  buildGmPool,
  resolvePlayerDice,
  gmSuccesses,
  countOnes,
  reduceGmSuccessesPerOne,
  corpseEaterBlood,
  injuryCheck,
  reinforce,
  LAST_STAND_DICE,
} from "../engine/index.js";
import { CHARACTERS_BY_ID } from "../data/characters.js";

/**
 * The server-authoritative command handler (CLAUDE.md §3.1). Pure: given the
 * current state, an intent, and dice/clock dependencies, it returns the events to
 * append (or an error). The Durable Object (room.ts) is the only thing that calls
 * this — it injects a real roller and clock, then persists/broadcasts the result.
 *
 * Because the server rolls here, clients cannot fudge dice; and because the rolled
 * results land in DICE_ROLLED events, replay is deterministic (§3 event sourcing).
 */

/** An event to append, before the store assigns id/seq/ts. */
export type EventInput = {
  [T in EventType]: { type: T; payload: EventPayloads[T]; actor?: Actor };
}[EventType];

export interface IntentDeps {
  roller: DiceRoller;
  now: number;
  /** Who sent the intent (the connection's authenticated seat, or 'gm'). */
  actor: Actor;
  /**
   * For a `claim_seat` intent: the SHA-256 hash of the freshly-minted seat token,
   * injected by the DO (which mints the raw token, hands it to the claimant, and
   * keeps only this hash in the log — §3.6). Absent for every other intent.
   */
  seatTokenHash?: string;
}

export type IntentResult =
  | { ok: true; events: EventInput[] }
  | { ok: false; error: string };

const ok = (events: EventInput[]): IntentResult => ({ ok: true, events });
const err = (error: string): IntentResult => ({ ok: false, error });

/** Passive ids currently active for a character (abilities always; advances if unlocked). */
function activePassiveIds(seat: CharId, state: GameState): Set<string> {
  const sheet = CHARACTERS_BY_ID[seat];
  const runtime = state.characters[seat];
  const ids = new Set<string>();
  if (!sheet) return ids;
  for (const p of sheet.abilities) if (p.mechanic === "passive") ids.add(p.id);
  for (const p of sheet.advances) {
    if (p.mechanic === "passive" && runtime.unlockedAdvances.includes(p.id)) ids.add(p.id);
  }
  return ids;
}

/** The penalty label for a character's 2nd injury box in a category. */
function penaltyLabel(seat: CharId, category: 0 | 1 | 2): string | undefined {
  return CHARACTERS_BY_ID[seat]?.injuries[category]?.boxes[1]?.penalty;
}

export function processIntent(state: GameState, intent: Intent, deps: IntentDeps): IntentResult {
  switch (intent.kind) {
    case "create_game":
      return ok([{ type: "GAME_CREATED", payload: { createdAt: deps.now } }]);

    case "claim_seat": {
      // A claimed seat can only be re-occupied via the reclaim handshake (hello +
      // matching token, handled in the DO) or after a GM release — never by a fresh
      // claim, so two people can't hold the same character (§3.6).
      if (state.seats[intent.seat]?.claimed) return err("seat already claimed");
      return ok([{ type: "ROLE_CLAIMED", payload: { seat: intent.seat, ...(deps.seatTokenHash ? { seatTokenHash: deps.seatTokenHash } : {}) } }]);
    }
    case "release_seat":
      return ok([{ type: "SEAT_RELEASED", payload: { seat: intent.seat } }]);

    case "start_session":
      return ok([{ type: "SESSION_STARTED", payload: {} }]);
    case "end_session":
      return ok([{ type: "SESSION_ENDED", payload: {} }]);

    case "set_safety":
      return ok([{ type: "SAFETY_SET", payload: { ...(intent.lines ? { lines: intent.lines } : {}), ...(intent.veils ? { veils: intent.veils } : {}), ...(intent.calibration ? { calibration: intent.calibration } : {}) } }]);
    case "raise_xcard":
      return ok([{ type: "XCARD_RAISED", payload: { ...(intent.anonymous ? { anonymous: true } : {}), ...(intent.note ? { note: intent.note } : {}) } }]);
    case "clear_xcard":
      return ok([{ type: "XCARD_CLEARED", payload: { ...(intent.changeRequested ? { changeRequested: intent.changeRequested } : {}) } }]);
    case "traffic_signal":
      return ok([{ type: "TRAFFIC_SIGNAL", payload: { color: intent.color } }]);

    case "frame_scene":
      return ok([{ type: "SCENE_FRAMED", payload: { objectives: intent.objectives, threats: intent.threats, ...(intent.secondaryObjectives ? { secondaryObjectives: intent.secondaryObjectives } : {}) } }]);
    case "add_objective":
      return ok([{ type: "OBJECTIVE_ADDED", payload: { objective: intent.objective } }]);
    case "update_objective":
      return ok([{ type: "OBJECTIVE_UPDATED", payload: { id: intent.id, patch: intent.patch } }]);
    case "complete_objective":
      return ok([{ type: "OBJECTIVE_COMPLETED", payload: { id: intent.id, ...(intent.narratedBy ? { narratedBy: intent.narratedBy } : {}) } }]);
    case "add_threat":
      return ok([{ type: "THREAT_ADDED", payload: { threat: intent.threat } }]);
    case "update_threat":
      return ok([{ type: "THREAT_UPDATED", payload: { id: intent.id, patch: intent.patch } }]);
    case "remove_threat":
      return ok([{ type: "THREAT_REMOVED", payload: { id: intent.id } }]);
    case "add_secondary_objective":
      return ok([{ type: "SECONDARY_OBJECTIVE_ADDED", payload: { objective: intent.objective } }]);
    case "complete_secondary_objective":
      return ok([{ type: "SECONDARY_OBJECTIVE_COMPLETED", payload: { id: intent.id, ...(intent.rewardChoice ? { rewardChoice: intent.rewardChoice } : {}) } }]);

    case "start_turn":
      return ok([{ type: "TURN_STARTED", payload: { seat: intent.seat, stat: intent.stat, engagedThreatIds: intent.engagedThreatIds, ...(intent.tags ? { tags: intent.tags } : {}) }, actor: intent.seat }]);
    case "cancel_turn": {
      const turn = state.currentTurn;
      if (!turn) return err("no turn in progress");
      return ok([{ type: "TURN_CANCELLED", payload: { seat: turn.seat }, actor: turn.seat }]);
    }

    case "roll": {
      const turn = state.currentTurn;
      if (!turn) return err("no turn in progress");
      // Server builds the GM pool from current threats (RULES §4) and rolls both.
      const gmDice = buildGmPool(state.board.threats, turn.engagedThreatIds);
      const playerResults = deps.roller.roll(intent.playerPoolDice);
      const gmResults = deps.roller.roll(gmDice);
      return ok([
        { type: "POOL_BUILT", payload: { who: "player", dice: intent.playerPoolDice, sources: intent.sources ?? [] }, actor: turn.seat },
        { type: "POOL_BUILT", payload: { who: "gm", dice: gmDice } },
        { type: "DICE_ROLLED", payload: { who: "player", results: playerResults }, actor: turn.seat },
        { type: "DICE_ROLLED", payload: { who: "gm", results: gmResults } },
      ]);
    }

    case "resolve_discard": {
      const turn = state.currentTurn;
      if (!turn?.playerDice || !turn.gmDice) return err("dice not rolled yet");

      // Discard threshold: 3 normally, raised by an engaged Rust-Witch (Aura of Misfortune).
      const thresholds = state.board.threats
        .filter((t) => turn.engagedThreatIds.includes(t.id) && t.discardThreshold !== undefined)
        .map((t) => t.discardThreshold as number);
      const threshold = Math.max(3, ...thresholds);

      const { survivors } = resolvePlayerDice(turn.playerDice, threshold);
      const playerOnes = countOnes(turn.playerDice);
      let gmCount = gmSuccesses(turn.gmDice).length;
      const events: EventInput[] = [];
      const passives = activePassiveIds(turn.seat, state);

      // Pre-discard: reduce GM successes per player 1 (Dead Man's Luck / Bone Armour).
      if (playerOnes > 0 && (passives.has("dead-mans-luck") || passives.has("bone-armour"))) {
        const reduced = reduceGmSuccessesPerOne(gmCount, playerOnes);
        const passiveId = passives.has("dead-mans-luck") ? "dead-mans-luck" : "bone-armour";
        events.push({ type: "PASSIVE_APPLIED", payload: { passiveId, gmSuccessDelta: reduced - gmCount, detail: `-${gmCount - reduced} GM success per rolled 1` }, actor: turn.seat });
        gmCount = reduced;
      }
      // Pre-discard: Corpse Eater +1 Blood on any 1.
      if (passives.has("corpse-eater")) {
        const blood = corpseEaterBlood(turn.playerDice);
        if (blood > 0) events.push({ type: "PASSIVE_APPLIED", payload: { passiveId: "corpse-eater", bloodDelta: blood, detail: "+1 Blood on a rolled 1" }, actor: turn.seat });
      }

      events.push({ type: "DICE_DISCARDED", payload: { playerSurvivors: survivors.map((s) => s.face), gmSuccessCount: gmCount } });
      return ok(events);
    }

    case "allocate": {
      const turn = state.currentTurn;
      if (!turn) return err("no turn in progress");
      return ok(
        intent.allocations.map((a) => ({
          type: "DIE_ALLOCATED" as const,
          payload: { kind: a.kind, units: a.units, ...(a.targetId ? { targetId: a.targetId } : {}), ...(a.specialId ? { specialId: a.specialId } : {}) },
          actor: turn.seat,
        })),
      );
    }

    case "commit": {
      const turn = state.currentTurn;
      if (!turn) return err("no turn in progress");
      const events: EventInput[] = [];
      const leftover = turn.gmDiceRemaining ?? 0;
      let death = false;
      if (leftover > 0) {
        const outcome = injuryCheck(leftover, state.characters[turn.seat].injuries, deps.roller);
        if (outcome.kind === "injury") {
          events.push({ type: "INJURY_MARKED", payload: { seat: turn.seat, category: outcome.category, box: outcome.box, ...(outcome.penaltyTriggered ? { penalty: penaltyLabel(turn.seat, outcome.category) } : {}) }, actor: turn.seat });
        } else if (outcome.kind === "downed") {
          events.push({ type: "DOWNED", payload: { seat: turn.seat, category: outcome.category }, actor: turn.seat });
        } else if (outcome.kind === "death") {
          // Death opens a Last Stand instead of ending the turn — the dying vampire gets
          // one final 8d6 (RULES §5). DEATH_LAST_STAND replaces the turn with a Last
          // Stand; we skip ALLOCATION_COMMITTED so the seat isn't retired prematurely.
          death = true;
          events.push({ type: "DEATH_LAST_STAND", payload: { seat: turn.seat }, actor: turn.seat });
        }
      }
      if (!death) events.push({ type: "ALLOCATION_COMMITTED", payload: {}, actor: turn.seat });
      return ok(events);
    }

    case "last_stand_roll": {
      const turn = state.currentTurn;
      if (!turn?.lastStand) return err("not in a Last Stand");
      if (turn.playerDice) return err("the Last Stand dice are already cast");
      return ok([
        { type: "LAST_STAND_ROLLED", payload: { seat: turn.seat, dice: deps.roller.roll(LAST_STAND_DICE) }, actor: turn.seat },
      ]);
    }

    case "last_stand_commit": {
      const turn = state.currentTurn;
      if (!turn?.lastStand) return err("not in a Last Stand");
      // Apply the final dice to the board (DIE_ALLOCATED mutates Objectives/Threats the
      // same way a normal turn does), then the vampire retires.
      const events: EventInput[] = intent.allocations.map((a) => ({
        type: "DIE_ALLOCATED" as const,
        payload: { kind: a.kind, units: a.units, ...(a.targetId ? { targetId: a.targetId } : {}), ...(a.specialId ? { specialId: a.specialId } : {}) },
        actor: turn.seat,
      }));
      events.push({ type: "LAST_STAND_ENDED", payload: { seat: turn.seat }, actor: turn.seat });
      return ok(events);
    }

    case "end_round": {
      const reducedToZero = new Set(intent.reducedToZeroThreatIds ?? state.board.threats.filter((t) => t.rating <= 0).map((t) => t.id));
      const zeroSuccess = new Set(intent.zeroSuccessThreatIds ?? []);
      const { threats } = reinforce({ threats: state.board.threats, reducedToZeroThisRound: reducedToZero, zeroSuccessThisRound: zeroSuccess, roller: deps.roller });
      return ok([
        { type: "REINFORCEMENTS_APPLIED", payload: { threats } },
        { type: "ROUND_ENDED", payload: {} },
      ]);
    }

    case "change_blood":
      return ok([{ type: "BLOOD_CHANGED", payload: { seat: intent.seat, delta: intent.delta, ...(intent.reason ? { reason: intent.reason } : {}) }, actor: intent.seat }]);
    case "share_blood":
      return ok([{ type: "BLOOD_SHARED", payload: { from: intent.from, to: intent.to, amount: intent.amount }, actor: intent.from }]);
    case "heal":
      return ok([{ type: "HEALED", payload: { seat: intent.seat, category: intent.category, box: intent.box }, actor: intent.seat }]);
    case "use_equipment":
      return ok([{ type: "EQUIPMENT_USED", payload: { seat: intent.seat, itemId: intent.itemId }, actor: intent.seat }]);
    case "loot_add":
      return ok([{ type: "LOOT_ADDED", payload: { seat: intent.seat, item: intent.item }, actor: intent.seat }]);
    case "loot_activate":
      return ok([{ type: "LOOT_ACTIVATED", payload: { seat: intent.seat, itemId: intent.itemId }, actor: intent.seat }]);
    case "unlock_advance":
      return ok([{ type: "ADVANCE_UNLOCKED", payload: { seat: intent.seat, advanceId: intent.advanceId }, actor: intent.seat }]);
    case "trigger_flashback":
      return ok([{ type: "FLASHBACK_TRIGGERED", payload: { seat: intent.seat, context: intent.context, question: intent.question }, actor: intent.seat }]);

    case "gm_override":
      return ok([{ type: "GM_OVERRIDE", payload: { ...(intent.note ? { note: intent.note } : {}), ...(intent.patch ? { patch: intent.patch } : {}) } }]);

    default:
      return err(`unknown intent: ${(intent as { kind: string }).kind}`);
  }
}
