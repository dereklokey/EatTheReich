import type { GameState, TurnState } from "../state/types.js";
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
  whiffAnchor,
  resolvePlayerDice,
  gmSuccessTally,
  countSixes,
  countOnes,
  reduceGmSuccessesPerOne,
  corpseEaterBlood,
  resolveInjury,
  rendInjury,
  reinforce,
  lowerChallenge,
  isBoardSpecialId,
  LAST_STAND_DICE,
} from "../engine/index.js";
import { CHARACTERS_BY_ID } from "../data/characters.js";
import { activeMantle } from "../state/stances.js";
import { flashbackTriggerable, FLASHBACK_BONUS_DICE } from "../data/flashbacks.js";
import { threatInPlay, anathemaInPlay, rendingClawsInPlay } from "../domain/types.js";
import type { DieFace, Target, SecondaryObjective } from "../domain/types.js";
import type { Equipment, Power } from "../domain/character.js";

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

/** Player discard threshold: 3, raised while a Rust-Witch is in play (Aura of Misfortune).
 *  A *staged* (not-yet-activated) Rust-Witch imposes nothing — its Aura begins only once the
 *  GM brings it into play (issue #12), so we gate on {@link threatInPlay}, not just rating. */
function discardThreshold(state: GameState): number {
  const thresholds = state.board.threats
    .filter((t) => threatInPlay(t) && t.discardThreshold !== undefined)
    .map((t) => t.discardThreshold as number);
  return Math.max(3, ...thresholds);
}

/**
 * The Blood a SPECIAL grants on activation, if any (Flint's Ravenous → +3). Looks across
 * the seat's start abilities and *unlocked* advances — a SPECIAL can only be allocated to
 * once it's been offered, which already requires it to be unlocked. Returns the power's name
 * for the BLOOD_CHANGED reason so the log reads "Ravenous".
 */
function specialBloodGrant(state: GameState, seat: CharId, specialId: string): { amount: number; name: string } | undefined {
  const sheet = CHARACTERS_BY_ID[seat];
  if (!sheet) return undefined;
  const unlocked = state.characters[seat]?.unlockedAdvances ?? [];
  const power =
    sheet.abilities.find((p) => p.id === specialId) ??
    sheet.advances.find((p) => p.id === specialId && unlocked.includes(p.id));
  return power?.grantsBlood ? { amount: power.grantsBlood, name: power.name } : undefined;
}

/**
 * The Attack-rating reduction a SPECIAL inflicts on a chosen Threat (Iryna's Deadeye Shot /
 * Cosgrave's Back-Pocket Hex → −1; rulebook pp51/57). Same lookup as {@link specialBloodGrant}
 * but for the `reduceThreatAttack` descriptor — a crit spent on one of these, with a target
 * Threat, drops that Threat's Attack as a logged, GM-editable default. Returns the power's name
 * so the log reads "Deadeye Shot".
 */
function specialAttackReduction(state: GameState, seat: CharId, specialId: string): { amount: number; name: string } | undefined {
  const sheet = CHARACTERS_BY_ID[seat];
  if (!sheet) return undefined;
  const unlocked = state.characters[seat]?.unlockedAdvances ?? [];
  const power =
    sheet.abilities.find((p) => p.id === specialId) ??
    sheet.advances.find((p) => p.id === specialId && unlocked.includes(p.id));
  return power?.reduceThreatAttack ? { amount: power.reduceThreatAttack, name: power.name } : undefined;
}

/**
 * The flat rating damage a SPECIAL inflicts on a chosen Threat OR Objective (Astrid's Apex Predator
 * → 3 on a Threat, rulebook p57; Chuck's Elbow Grease → 4 on an Objective, rulebook p52). Same sheet
 * lookup as {@link specialBloodGrant}, for the `reduceThreatRating` / `reduceObjectiveRating`
 * descriptors (a power carries one or the other). Computed server-side so the carried `ratingDamage`
 * is authoritative (anti-fudge), not trusted from the client allocation. The effect rides the
 * DIE_ALLOCATED through the engine, which applies it to whichever board entity `targetId` names
 * (bypassing Challenge; a Threat at rating 0 → Attack 0), so no separate event is needed.
 */
function specialRatingReduction(state: GameState, seat: CharId, specialId: string): number | undefined {
  const sheet = CHARACTERS_BY_ID[seat];
  if (!sheet) return undefined;
  const unlocked = state.characters[seat]?.unlockedAdvances ?? [];
  const power =
    sheet.abilities.find((p) => p.id === specialId) ??
    sheet.advances.find((p) => p.id === specialId && unlocked.includes(p.id));
  return power?.reduceThreatRating ?? power?.reduceObjectiveRating;
}

/**
 * GM Attack dice a targetless SPECIAL sheds this turn (Astrid's Unnatural Endurance → 3; rulebook
 * p57). Same sheet lookup as {@link specialBloodGrant}, for the `reduceGmDice` descriptor. Computed
 * server-side so the carried `gmDiceReduction` is authoritative (anti-fudge). Rides the DIE_ALLOCATED
 * through the engine's `gmDiceRemaining` — no board target, no separate event.
 */
function specialGmDiceReduction(state: GameState, seat: CharId, specialId: string): number | undefined {
  const sheet = CHARACTERS_BY_ID[seat];
  if (!sheet) return undefined;
  const unlocked = state.characters[seat]?.unlockedAdvances ?? [];
  const power =
    sheet.abilities.find((p) => p.id === specialId) ??
    sheet.advances.find((p) => p.id === specialId && unlocked.includes(p.id));
  return power?.reduceGmDice;
}

/**
 * The Challenge a SPECIAL lowers on a chosen Objective- OR Threat (Nicole's Sapper → −1; rulebook
 * p59). Same sheet lookup as {@link specialBloodGrant}, for the `reduceChallenge` descriptor —
 * a crit spent on one of these, with a target, drops that target's Challenge as a logged,
 * GM-editable default. The drop itself routes through {@link lowerChallenge} in the allocate branch
 * (so the Werhund's lock is honoured); this just resolves the amount + the power's name for the log.
 */
function specialChallengeReduction(state: GameState, seat: CharId, specialId: string): { amount: number; name: string } | undefined {
  const sheet = CHARACTERS_BY_ID[seat];
  if (!sheet) return undefined;
  const unlocked = state.characters[seat]?.unlockedAdvances ?? [];
  const power =
    sheet.abilities.find((p) => p.id === specialId) ??
    sheet.advances.find((p) => p.id === specialId && unlocked.includes(p.id));
  return power?.reduceChallenge ? { amount: power.reduceChallenge, name: power.name } : undefined;
}

/**
 * A seat's no-die ACTIVE that lowers Challenge from the sheet, by id (Astrid's Tethered Phantom /
 * Flint's Hellish Screech, issue #35). Same unlock-aware lookup as the SPECIAL helpers — an ability
 * always, an advance only once unlocked (anti-fudge: a locked advance has no descriptor, so it can't
 * fire) — for the `sheetChallengeReduction` descriptor (both these powers are advances). Returns the
 * whole Power so the caller has the descriptor (amount/scope/expiry), `bloodCost`, and the name for the
 * BLOOD_CHANGED / CHALLENGE_REDUCED log. The drop itself routes through {@link lowerChallenge} (Werhund
 * lock honoured), exactly like Sapper's crit path.
 */
function sheetChallengePower(state: GameState, seat: CharId, powerId: string): Power | undefined {
  const sheet = CHARACTERS_BY_ID[seat];
  if (!sheet) return undefined;
  const unlocked = state.characters[seat]?.unlockedAdvances ?? [];
  const power =
    sheet.abilities.find((p) => p.id === powerId) ??
    sheet.advances.find((p) => p.id === powerId && unlocked.includes(p.id));
  return power?.sheetChallengeReduction ? power : undefined;
}

/**
 * The no-die ACTIVE that arms a cross-turn stance (Iryna's Hell's Ravenous Fire / Enervation of the Soul /
 * Mantle of the Fell Beast, #36), for the `set_stance` intent. Same sheet lookup + advance gate as
 * {@link sheetChallengePower}, for the `setsStance` descriptor — so a LOCKED advance yields nothing
 * (anti-fudge; the stance can't be armed until the advance is unlocked).
 */
function stancePower(state: GameState, seat: CharId, powerId: string): Power | undefined {
  const sheet = CHARACTERS_BY_ID[seat];
  if (!sheet) return undefined;
  const unlocked = state.characters[seat]?.unlockedAdvances ?? [];
  const power =
    sheet.abilities.find((p) => p.id === powerId) ??
    sheet.advances.find((p) => p.id === powerId && unlocked.includes(p.id));
  return power?.setsStance ? power : undefined;
}

/**
 * Enervation of the Soul (#36): the flat rating damage its granted SPECIAL inflicts when a crit is
 * allocated to it. The grant lives on the turn (`turn.enervation`, set at TURN_STARTED when the stance
 * was consumed), NOT on a sheet `special` power — so unlike Apex Predator (#27, {@link specialRatingReduction})
 * this is keyed off the turn, identified by the crit's `specialId` matching the granting power. Folds
 * through the SAME `ratingDamage` engine path, so it bypasses Challenge and rating 0 → Attack 0.
 */
function enervationRatingDamage(state: GameState, specialId: string): number | undefined {
  const en = state.currentTurn?.enervation;
  return en && en.powerId === specialId ? en.damage : undefined;
}

/**
 * The healing SPECIAL that clears one of the acting vampire's own marked Injury boxes (Astrid's
 * Nightmare Regeneration → clear a marked Injury; rulebook p55). Same sheet lookup as
 * {@link specialBloodGrant}, for the `clearsInjury` descriptor — so a LOCKED advance yields nothing
 * (anti-fudge, the heal can't fire until the advance is unlocked). Returns the power's name for the
 * HEALED log; the *which box* is resolved server-side from the live injury track in the allocate branch.
 */
function specialInjuryClear(state: GameState, seat: CharId, specialId: string): { name: string } | undefined {
  const sheet = CHARACTERS_BY_ID[seat];
  if (!sheet) return undefined;
  const unlocked = state.characters[seat]?.unlockedAdvances ?? [];
  const power =
    sheet.abilities.find((p) => p.id === specialId) ??
    sheet.advances.find((p) => p.id === specialId && unlocked.includes(p.id));
  return power?.clearsInjury ? { name: power.name } : undefined;
}

/**
 * The seat's Scavenger SPECIAL, if any (Nicole's Scavenger → throw a salvage d6, restore the matching
 * numbered weapon; rulebook, Nicole sheet, issue #32). Same sheet lookup as {@link specialBloodGrant},
 * for the `scavenges` descriptor — so a LOCKED advance yields nothing (anti-fudge; the salvage can't
 * fire until the power is available). Returns the power's id + name for the SCAVENGER_ROLLED event.
 */
function scavengerPower(state: GameState, seat: CharId): { id: string; name: string } | undefined {
  const sheet = CHARACTERS_BY_ID[seat];
  if (!sheet) return undefined;
  const unlocked = state.characters[seat]?.unlockedAdvances ?? [];
  const power =
    sheet.abilities.find((p) => p.scavenges) ??
    sheet.advances.find((p) => p.scavenges && unlocked.includes(p.id));
  return power ? { id: power.id, name: power.name } : undefined;
}

/**
 * The Blood a triggered PASSIVE pays the actor for reducing a Threat's rating to 0 — Nicole's Feed
 * on Fear (+3, rulebook, Nicole advance; issue #33). Scans the seat's *active* passives (abilities
 * always; advances only once {@link activePassiveIds} confirms they're unlocked — so a locked
 * Feed on Fear yields nothing, anti-fudge) for the `bloodOnThreatKill` descriptor. Returns the
 * amount + the power's name for the BLOOD_CHANGED reason.
 */
function feedOnThreatKill(state: GameState, seat: CharId): { amount: number; name: string } | undefined {
  const sheet = CHARACTERS_BY_ID[seat];
  if (!sheet) return undefined;
  const active = activePassiveIds(seat, state);
  const power = [...sheet.abilities, ...sheet.advances].find((p) => active.has(p.id) && p.bloodOnThreatKill);
  return power?.bloodOnThreatKill ? { amount: power.bloodOnThreatKill, name: power.name } : undefined;
}

/**
 * The flat rating a triggered PASSIVE corrodes off a chosen Threat when the actor marks an Injury —
 * Chuck's Corrosive Fluids (−2, rulebook, Chuck advance; issue #34). Scans the seat's *active*
 * passives (abilities always; advances only once {@link activePassiveIds} confirms they're unlocked —
 * so a locked Corrosive Fluids corrodes nothing, anti-fudge) for the `reduceThreatRatingOnInjury`
 * descriptor. Returns the amount + the power's name for the THREAT_RATING_REDUCED log.
 */
function corrosiveOnInjury(state: GameState, seat: CharId): { amount: number; id: string; name: string } | undefined {
  const sheet = CHARACTERS_BY_ID[seat];
  if (!sheet) return undefined;
  const active = activePassiveIds(seat, state);
  const power = [...sheet.abilities, ...sheet.advances].find((p) => active.has(p.id) && p.reduceThreatRatingOnInjury);
  return power?.reduceThreatRatingOnInjury ? { amount: power.reduceThreatRatingOnInjury, id: power.id, name: power.name } : undefined;
}

/**
 * Feed on Fear (#33) at the action's conclusion: a logged, GM-editable BLOOD_CHANGED for every Threat
 * this turn's allocations reduced to rating 0. Resolved at `commit` (TURN_END) off the post-allocation
 * board — the kill already landed during ALLOCATE, which mutates the board live — so it fires whether
 * or not a GM die gets through to the injury check. "Damaged a Threat this turn AND it now sits at 0"
 * is the same kill heuristic the after-action report uses: an `eliminate` die, a sheet SPECIAL's flat
 * `ratingDamage` (Apex Predator), or a board-granted Crash & Burn (carried in `units` behind a
 * namespaced id). A Set so two dice finishing one Threat pay once; per-Threat so a double kill pays
 * twice (clamped to 10 in the reducer). Empty unless the seat has the descriptor unlocked.
 */
function feedOnFearEvents(state: GameState, turn: TurnState): EventInput[] {
  const grant = feedOnThreatKill(state, turn.seat);
  if (!grant) return [];
  const killed = new Set<string>();
  for (const a of turn.allocations) {
    if (!a.targetId) continue;
    const hitsThreat =
      a.kind === "eliminate" ||
      (a.kind === "special" && ((a.ratingDamage ?? 0) > 0 || isBoardSpecialId(a.specialId)));
    if (!hitsThreat) continue;
    const thr = state.board.threats.find((t) => t.id === a.targetId);
    if (thr && thr.rating === 0) killed.add(thr.id);
  }
  return [...killed].map(() => ({
    type: "BLOOD_CHANGED" as const,
    payload: { seat: turn.seat, delta: grant.amount, reason: grant.name },
    actor: turn.seat,
  }));
}

/**
 * GM-whiff escalation (RULES §8, rulebook p38), applied at the conclusion of the action it
 * happened in (NOT at end of round). If the Reich's Attack roll this turn produced zero
 * successes, the lead (anchor) Threat presses harder: +1 Attack. Returns the THREAT_UPDATED
 * event to append just before the turn closes, or `null` when there was no whiff / no Threat
 * left to escalate. Read off the post-allocation board so a Threat the player just killed
 * isn't the one that gets madder.
 */
function gmWhiffEvent(state: GameState): EventInput | null {
  const turn = state.currentTurn;
  const anchor = turn ? whiffAnchor(state.board.threats, turn.gmDice ?? []) : null;
  if (!anchor) return null;
  // Paratrooper 'Rapid Deployment' (#22, rulebook p61): the whiff's +1 Attack is itself a
  // Reinforcement bump, so the anchor's rating also climbs +2.
  const rapid = (anchor.rules ?? []).includes("rapid-deployment");
  return {
    type: "GM_WHIFF",
    payload: { threatId: anchor.id, name: anchor.name, attack: anchor.attack + 1, ...(rapid ? { rating: anchor.rating + 2 } : {}) },
  };
}

/** Find an item by id across the character's sheet equipment and earned loot. */
function findEquipment(state: GameState, seat: CharId, itemId: string): Equipment | undefined {
  return (
    CHARACTERS_BY_ID[seat]?.equipment.find((e) => e.id === itemId) ??
    state.characters[seat]?.loot.find((l) => l.id === itemId)
  );
}

/** A Rust-Witch is *in play* (issue #13). Its Rust Curse fires only once the GM has brought
 *  it onto the battlefield — never while it's staged (#12) or already defeated (rating 0). */
function rustWitchInPlay(state: GameState): boolean {
  return state.board.threats.some((t) => threatInPlay(t) && (t.rules ?? []).includes("rust-curse"));
}

/**
 * Einherjar 'Painless' (rulebook p55, issue #19): each 1 in the Reich's Attack roll raises this
 * enemy's Challenge by 1 for the action. The 1s are counted across the WHOLE aggregate pool (it's
 * a property of the board, not of which Threat the player faces), and every in-play 'painless'
 * Threat soaks that much extra this turn. Returns one raise event per affected Threat (none when
 * the roll held no 1s, or no 'painless' Threat is in play). A staged/defeated Einherjar imposes
 * nothing — gated on {@link threatInPlay}, mirroring the Aura/Rust-Curse treatment.
 */
function painlessRaises(state: GameState, gmDice: readonly DieFace[]): EventInput[] {
  const ones = countOnes(gmDice);
  if (ones === 0) return [];
  return state.board.threats
    .filter((t) => threatInPlay(t) && (t.rules ?? []).includes("painless"))
    .map((t) => ({
      type: "ENEMY_CHALLENGE_RAISED" as const,
      payload: { threatId: t.id, threatName: t.name, amount: ones, ones, rule: "painless" },
      actor: "system" as const,
    }));
}

/** A PC's gear eligible to rust (issue #13): sheet equipment + earned loot that still has
 *  uses left. Already-spent or use-less items are skipped so the curse wastes nothing — and
 *  every eligible item is use-tracked, so the resulting zero is a clean, repairable degrade. */
function degradableEquipment(state: GameState, seat: CharId): Array<{ id: string; name: string }> {
  const runtime = state.characters[seat];
  if (!runtime) return [];
  const all = [...(CHARACTERS_BY_ID[seat]?.equipment ?? []), ...runtime.loot];
  return all
    .filter((item) => (runtime.equipmentUses[item.id] ?? 0) > 0)
    .map((item) => ({ id: item.id, name: item.name }));
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
      return ok([{ type: "SCENE_FRAMED", payload: { objectives: intent.objectives, threats: intent.threats, ...(intent.secondaryObjectives ? { secondaryObjectives: intent.secondaryObjectives } : {}), ...(intent.locationId ? { locationId: intent.locationId } : {}) } }]);
    case "add_objective":
      return ok([{ type: "OBJECTIVE_ADDED", payload: { objective: intent.objective } }]);
    case "update_objective":
      return ok([{ type: "OBJECTIVE_UPDATED", payload: { id: intent.id, patch: intent.patch } }]);
    case "complete_objective": {
      const events: EventInput[] = [
        { type: "OBJECTIVE_COMPLETED", payload: { id: intent.id, ...(intent.narratedBy ? { narratedBy: intent.narratedBy } : {}) } },
      ];
      // "If not rescued before moving on, the vampire is captured" (RULES §5, issue #16). Completing
      // the LAST in-play main Objective is the scene moving on: any vampire still Downed (rescue unmet)
      // is captured. A logged, GM-rewindable default (§0); the rescue Secondary stays on the board for
      // the GM to clear or carry into a later scene. A Downed PC whose rescue already completed is no
      // longer `downed`, so only the genuinely unrescued get swept up here.
      const remainingObjectives = state.board.objectives.filter((o) => o.id !== intent.id && o.rating > 0);
      if (remainingObjectives.length === 0) {
        for (const c of Object.values(state.characters)) {
          if (c.downed && !c.captured && !c.dead) {
            events.push({ type: "CHARACTER_CAPTURED", payload: { seat: c.id, ...(c.rescueObjectiveId ? { rescueObjectiveId: c.rescueObjectiveId } : {}) } });
          }
        }
      }
      return ok(events);
    }
    case "add_threat":
      return ok([{ type: "THREAT_ADDED", payload: { threat: intent.threat } }]);
    case "update_threat":
      return ok([{ type: "THREAT_UPDATED", payload: { id: intent.id, patch: intent.patch } }]);
    case "remove_threat":
      return ok([{ type: "THREAT_REMOVED", payload: { id: intent.id } }]);
    case "add_secondary_objective":
      return ok([{ type: "SECONDARY_OBJECTIVE_ADDED", payload: { objective: intent.objective } }]);
    case "update_secondary_objective":
      return ok([{ type: "SECONDARY_OBJECTIVE_UPDATED", payload: { id: intent.id, patch: intent.patch } }]);
    case "complete_secondary_objective":
      return ok([{ type: "SECONDARY_OBJECTIVE_COMPLETED", payload: { id: intent.id, ...(intent.rewardChoice ? { rewardChoice: intent.rewardChoice } : {}) } }]);
    case "remove_secondary_objective":
      return ok([{ type: "SECONDARY_OBJECTIVE_REMOVED", payload: { id: intent.id } }]);
    case "set_loot_revealed":
      return ok([{ type: "SCENE_LOOT_REVEALED", payload: { name: intent.name, revealed: intent.revealed } }]);

    case "start_turn": {
      // Consume any armed next-turn stances (Iryna's #36 actives) onto this turn-start event, so the
      // reducer both applies the buff to this turn AND clears the stance, and replay stays faithful.
      const stances = state.characters[intent.seat]?.stances ?? [];
      const ignore = stances.find((s) => s.kind === "ignore-threat-challenge");
      const enerv = stances.find((s) => s.kind === "enervation");
      return ok([{
        type: "TURN_STARTED",
        payload: {
          seat: intent.seat,
          stat: intent.stat,
          ...(intent.tags ? { tags: intent.tags } : {}),
          ...(ignore ? { ignoreThreatChallenge: { powerId: ignore.powerId, powerName: ignore.powerName } } : {}),
          ...(enerv ? { enervation: { powerId: enerv.powerId, powerName: enerv.powerName, damage: enerv.damage ?? 0 } } : {}),
        },
        actor: intent.seat,
      }]);
    }
    case "cancel_turn": {
      const turn = state.currentTurn;
      if (!turn) return err("no turn in progress");
      return ok([{ type: "TURN_CANCELLED", payload: { seat: turn.seat }, actor: turn.seat }]);
    }

    case "roll": {
      const turn = state.currentTurn;
      if (!turn) return err("no turn in progress");
      // The player rolls; the Reich answers separately (`roll_gm`) so each side gets its
      // own beat at the table (issue #5). We still build the GM pool now from current
      // threats (RULES §4) and record it (POOL_BUILT) so everyone sees what's incoming.
      const gmDice = buildGmPool(state.board.threats);
      const playerResults = deps.roller.roll(intent.playerPoolDice);
      const events: EventInput[] = [
        { type: "POOL_BUILT", payload: { who: "player", dice: intent.playerPoolDice, sources: intent.sources ?? [] }, actor: turn.seat },
        { type: "POOL_BUILT", payload: { who: "gm", dice: gmDice } },
        { type: "DICE_ROLLED", payload: { who: "player", results: playerResults }, actor: turn.seat },
      ];
      // Uncontested action (no Threat in play → 0 GM dice): there's nothing for the Reich
      // to roll, so resolve its empty pool now and skip the GM-roll beat entirely.
      if (gmDice === 0) {
        events.push({ type: "DICE_ROLLED", payload: { who: "gm", results: [] } });
      }
      return ok(events);
    }

    case "roll_gm": {
      const turn = state.currentTurn;
      if (!turn) return err("no turn in progress");
      if (!turn.playerDice) return err("the player hasn't rolled yet");
      if (turn.gmDice) return err("the Reich has already rolled");
      // Roll the pool size already built and shown by `roll` (POOL_BUILT gm).
      const gmResults = deps.roller.roll(turn.gmPoolSize ?? 0);
      return ok([{ type: "DICE_ROLLED", payload: { who: "gm", results: gmResults } }]);
    }

    case "resolve_discard": {
      const turn = state.currentTurn;
      if (!turn?.playerDice || !turn.gmDice) return err("dice not rolled yet");

      const threshold = discardThreshold(state);
      const { survivors } = resolvePlayerDice(turn.playerDice, threshold);
      const playerOnes = countOnes(turn.playerDice);
      // Vampirjäger 'Anathema' (#21): while it's in play, each GM 6 scores 2 successes. Folded
      // into the base count BEFORE the player passives below, so Dead Man's Luck / Bone Armour
      // can still cancel the boosted successes. The bonus is recorded for the after-action report.
      const anathema = anathemaInPlay(state.board.threats);
      const anathemaBonus = anathema ? countSixes(turn.gmDice) : 0;
      let gmCount = gmSuccessTally(turn.gmDice, anathema);
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

      events.push({ type: "DICE_DISCARDED", payload: { playerSurvivors: survivors.map((s) => s.face), gmSuccessCount: gmCount, ...(anathemaBonus > 0 ? { anathemaBonus } : {}) } });
      // Einherjar 'Painless' (#19): the Reich's own 1s raise its Challenge for this action.
      // Read off the raw GM roll (independent of the player passives above) at this same window.
      events.push(...painlessRaises(state, turn.gmDice));
      return ok(events);
    }

    case "allocate": {
      const turn = state.currentTurn;
      if (!turn) return err("no turn in progress");
      const events: EventInput[] = [];
      // Running Attack per Threat so two Attack-shaving crits in one batch (Deadeye + Hex on the
      // same Threat) compose: each THREAT_ATTACK_REDUCED carries the resolved value the next reads.
      const attackNow = new Map<string, number>();
      // Running Challenge per target (Sapper, #29): two explosives crits on one target compose,
      // each CHALLENGE_REDUCED carrying the resolved value down through the lowerChallenge gate.
      const challengeNow = new Map<string, number>();
      // Running marked-box per injury category (Nightmare Regeneration, #31): two heal crits aimed at
      // one category clear two boxes — each HEALED reads the running value so the second peels off the
      // next box down (state.injuries doesn't update between allocations in this one intent batch).
      const healNow = new Map<0 | 1 | 2, number>();
      for (const a of intent.allocations) {
        // Apex Predator (#27): a sheet SPECIAL's flat rating damage is recomputed from the power
        // descriptor here (server-authoritative) and carried on DIE_ALLOCATED, so the engine
        // applies it (bypassing Challenge, rating 0 → Attack 0) — the client's value is ignored.
        // Enervation of the Soul (#36): the same flat-damage fold, but the amount comes off the turn's
        // granted SPECIAL (`turn.enervation`) rather than a sheet `special` power.
        const ratingDamage =
          a.kind === "special" && a.specialId && a.targetId
            ? specialRatingReduction(state, turn.seat, a.specialId) ?? enervationRatingDamage(state, a.specialId)
            : undefined;
        // Unnatural Endurance (#28): a targetless SPECIAL's GM-dice reduction, also recomputed from
        // the descriptor server-side and carried on DIE_ALLOCATED so the engine sheds gmDiceRemaining.
        const gmDiceReduction =
          a.kind === "special" && a.specialId ? specialGmDiceReduction(state, turn.seat, a.specialId) : undefined;
        events.push({
          type: "DIE_ALLOCATED",
          payload: { kind: a.kind, units: a.units, ...(a.targetId ? { targetId: a.targetId } : {}), ...(a.specialId ? { specialId: a.specialId } : {}), ...(ratingDamage ? { ratingDamage } : {}), ...(gmDiceReduction ? { gmDiceReduction } : {}) },
          actor: turn.seat,
        });
        // A SPECIAL that's a pure self-buff applies its Blood here (Ravenous +3), as a logged
        // BLOOD_CHANGED the GM can still edit. Other SPECIALs stay GM-adjudicated (RULES §7).
        if (a.kind === "special" && a.specialId) {
          const grant = specialBloodGrant(state, turn.seat, a.specialId);
          if (grant) events.push({ type: "BLOOD_CHANGED", payload: { seat: turn.seat, delta: grant.amount, reason: grant.name }, actor: turn.seat });
          // A SPECIAL that shaves a chosen Threat's Attack (Deadeye Shot / Back-Pocket Hex, #26):
          // when the crit carries a target, drop that Threat's Attack by the descriptor's amount
          // as a logged, GM-editable THREAT_ATTACK_REDUCED. No target → no effect (just activated).
          const reduce = specialAttackReduction(state, turn.seat, a.specialId);
          const thr = a.targetId ? state.board.threats.find((t) => t.id === a.targetId) : undefined;
          if (reduce && thr) {
            const current = attackNow.get(thr.id) ?? thr.attack;
            const next = Math.max(0, current - reduce.amount);
            attackNow.set(thr.id, next);
            events.push({ type: "THREAT_ATTACK_REDUCED", payload: { threatId: thr.id, threatName: thr.name, amount: reduce.amount, attack: next, specialId: a.specialId, specialName: reduce.name }, actor: turn.seat });
          }
          // A SPECIAL that lowers a chosen target's Challenge (Sapper, #29): the target can be an
          // Objective OR a Threat, and the drop routes through lowerChallenge — so a Werhund's
          // 'Unlowerable Challenge' (#25) keeps its value and emits NOTHING (no fake reduction).
          const chalReduce = specialChallengeReduction(state, turn.seat, a.specialId);
          const chalTarget: Target | undefined = a.targetId
            ? state.board.objectives.find((o) => o.id === a.targetId) ?? state.board.threats.find((t) => t.id === a.targetId)
            : undefined;
          if (chalReduce && chalTarget) {
            const current = challengeNow.get(chalTarget.id) ?? chalTarget.challenge ?? 0;
            const next = lowerChallenge({ ...chalTarget, challenge: current }, chalReduce.amount);
            if (next < current) {
              challengeNow.set(chalTarget.id, next);
              events.push({ type: "CHALLENGE_REDUCED", payload: { targetId: chalTarget.id, targetName: chalTarget.name, targetKind: chalTarget.kind, amount: chalReduce.amount, challenge: next, specialId: a.specialId, specialName: chalReduce.name }, actor: turn.seat });
            }
          }
          // A SPECIAL that clears one of the acting vampire's own marked Injury boxes (Nightmare
          // Regeneration, #31): the crit carries the chosen category, and the box is resolved from the
          // live track here — the highest marked box (1 or 2). An unmarked category (box 0) emits
          // NOTHING (nothing to heal — the client can't mint a phantom HEALED). Composes via healNow.
          const heal = specialInjuryClear(state, turn.seat, a.specialId);
          if (heal && a.injuryCategory !== undefined) {
            const cat = a.injuryCategory;
            const box = healNow.get(cat) ?? state.characters[turn.seat].injuries[cat];
            if (box >= 1) {
              events.push({ type: "HEALED", payload: { seat: turn.seat, category: cat, box: box as 1 | 2, specialId: a.specialId, specialName: heal.name }, actor: turn.seat });
              healNow.set(cat, box - 1);
            }
          }
        }
      }
      return ok(events);
    }

    case "add_bonus_dice": {
      const turn = state.currentTurn;
      // Bonus dice land during ALLOCATE only (RULES §4): after discard, before the injury
      // check, and never during a Last Stand (whose 8d6 are fixed).
      if (!turn || !turn.survivors || turn.phase === "INJURY_CHECK" || turn.lastStand) return err("can only add bonus dice during allocation");
      const count = Math.max(1, Math.min(8, Math.floor(intent.count)));
      const threshold = discardThreshold(state);
      const results = deps.roller.roll(count);
      const { survivors } = resolvePlayerDice(results, threshold);
      return ok([
        { type: "BONUS_DICE_ROLLED", payload: { results, survivors: survivors.map((s) => s.face), count, ...(intent.label ? { label: intent.label } : {}) }, actor: turn.seat },
      ]);
    }

    case "scavenge": {
      // Nicole's Scavenger SPECIAL (#32): the player throws the salvage d6 as their own visible beat
      // in the arena once a crit is on the SPECIAL. The SERVER rolls it (anti-fudge, replayable — the
      // face is baked into the event), then maps it to the weapon carrying that scavengerSlot and
      // restores 1 use (in the reducer). Gated to the allocation window like `add_bonus_dice`; the
      // crit it's spent on commits as a normal `special` allocation at lock-in. Once per turn.
      const turn = state.currentTurn;
      if (!turn) return err("no turn in progress");
      if (!turn.survivors || turn.phase === "INJURY_CHECK" || turn.lastStand) return err("can only scavenge during allocation");
      if (turn.scavenge) return err("the salvage die has already been thrown this turn");
      const power = scavengerPower(state, turn.seat);
      if (!power) return err("this character has no Scavenger SPECIAL");
      const face = deps.roller.roll(1)[0]!;
      // Nicole fills all six slots, so every face matches; an unfilled slot (a future character with
      // gaps) restores nothing but still shows the throw — the item fields are simply omitted.
      const item = CHARACTERS_BY_ID[turn.seat]?.equipment.find((e) => e.scavengerSlot === face);
      return ok([
        {
          type: "SCAVENGER_ROLLED",
          payload: { seat: turn.seat, face, specialId: power.id, specialName: power.name, ...(item ? { itemId: item.id, itemName: item.name } : {}) },
          actor: turn.seat,
        },
      ]);
    }

    case "commit": {
      const turn = state.currentTurn;
      if (!turn) return err("no turn in progress");
      // Feed on Fear (#33): pay the actor for every Threat they reduced to 0 this turn (TURN_END
      // passive). Emitted in BOTH branches — the kill earns the Blood whether or not a GM die then
      // gets through to the injury check — and ahead of the whiff/commit so the log reads kill-first.
      const feed = feedOnFearEvents(state, turn);
      const leftover = turn.gmDiceRemaining ?? 0;
      // No GM die got through → no INJURY_CHECK; the turn just closes (no window flashes).
      // A GM whiff still presses the anchor Threat (+1 Attack) as the action concludes.
      if (leftover <= 0) {
        const whiff = gmWhiffEvent(state);
        return ok([...feed, ...(whiff ? [whiff] : []), { type: "ALLOCATION_COMMITTED", payload: {}, actor: turn.seat }]);
      }

      // A die got through → open the INJURY_CHECK window WITHOUT rolling yet. The category
      // die is its own visible beat (`roll_injury`): the wounded vampire throws it across
      // the board, then it parks for the reveal + reaction window.
      return ok([...feed, { type: "INJURY_CHECK_OPENED", payload: { seat: turn.seat }, actor: turn.seat }]);
    }

    case "roll_injury": {
      const turn = state.currentTurn;
      if (!turn || turn.phase !== "INJURY_CHECK") return err("no injury check is open");
      if (turn.pendingInjury) return err("the injury die is already thrown");
      const leftover = turn.gmDiceRemaining ?? 0;
      if (leftover <= 0) return err("no GM die got through");
      // Roll the injury d6 now (server-authoritative) but PARK it: the table sees the reveal
      // and can react (Chuck's hat) before INJURY_CHECK marks a box. `resolve_injury` applies
      // or shrugs it off. The face is stored so replay re-derives the same outcome.
      const face = deps.roller.roll(1)[0]!;
      const outcome = resolveInjury(leftover, state.characters[turn.seat].injuries, face);
      return ok([{ type: "INJURY_PENDING", payload: { seat: turn.seat, face, outcome }, actor: turn.seat }]);
    }

    case "resolve_injury": {
      const turn = state.currentTurn;
      const pending = turn?.pendingInjury;
      if (!turn || !pending) return err("no pending injury to resolve");
      const events: EventInput[] = [];
      // `ignore` (Chuck's hat, RULES §5) shrugs the whole thing off — the item was burned
      // via a separate use_equipment, so here we just commit with no injury marked.
      if (!intent.ignore) {
        // Werhund 'Rending Claws' (rulebook p64, issue #24): the table can attribute a normal
        // Injury to a Werhund in play, escalating it to fill the WHOLE category (still an
        // Injury, not a Downed). Gated like the other board specials — the flag does nothing
        // unless a Werhund is actually in play and the parked outcome is a normal injury.
        const rending = intent.rending === true && rendingClawsInPlay(state.board.threats);
        const o = rending ? rendInjury(pending.outcome) : pending.outcome;
        if (o.kind === "injury") {
          events.push({ type: "INJURY_MARKED", payload: { seat: turn.seat, category: o.category, box: o.box, ...(o.penaltyTriggered ? { penalty: penaltyLabel(turn.seat, o.category) } : {}), ...(rending ? { rending: true } : {}) }, actor: turn.seat });
          // Corrosive Fluids (#34): marking the wound corrodes a Threat the actor names (−2 rating).
          // A triggered passive (not a crit) — gated on the unlocked descriptor, and only when the
          // chosen Threat is in play with rating left to eat. Direct damage like Apex Predator: it
          // bypasses Challenge (rating 0 → Attack 0 in the reducer), logged as a GM-editable default.
          const corrosive = corrosiveOnInjury(state, turn.seat);
          const thr = intent.corrosiveTargetId ? state.board.threats.find((t) => t.id === intent.corrosiveTargetId) : undefined;
          if (corrosive && thr && threatInPlay(thr)) {
            const rating = Math.max(0, thr.rating - corrosive.amount);
            events.push({ type: "THREAT_RATING_REDUCED", payload: { threatId: thr.id, threatName: thr.name, amount: corrosive.amount, rating, passiveId: corrosive.id, passiveName: corrosive.name }, actor: turn.seat });
          }
        } else if (o.kind === "downed") {
          // Downed (RULES §5): auto-spawn the rescue Secondary Objective so the table never forgets a
          // dragged-clear vampire (issue #16). It's UNREVEALED — the GM sets its rating (the engine's
          // 2–4 default rides on the outcome) and reveals it once the fiction offers the rescue
          // (suggest, don't enforce: §0). The id is minted here and stamped onto DOWNED so the sheet
          // links the two; it's baked into both events, so replay re-derives the same pairing.
          const rescueId = `rescue-${turn.seat}-${deps.now}`;
          const charName = CHARACTERS_BY_ID[turn.seat]?.name ?? turn.seat;
          const rescue: SecondaryObjective = {
            id: rescueId,
            name: `Rescue ${charName}`,
            kind: "secondary",
            rating: o.rescueObjectiveRating,
            rescueFor: turn.seat,
            revealed: false,
          };
          events.push({ type: "DOWNED", payload: { seat: turn.seat, category: o.category, rescueObjectiveId: rescueId }, actor: turn.seat });
          events.push({ type: "SECONDARY_OBJECTIVE_ADDED", payload: { objective: rescue }, actor: turn.seat });
        } else if (o.kind === "death") {
          // Death opens a Last Stand (RULES §5) — DEATH_LAST_STAND replaces the turn, so we
          // skip ALLOCATION_COMMITTED to avoid retiring the seat before the final 8d6.
          return ok([{ type: "DEATH_LAST_STAND", payload: { seat: turn.seat }, actor: turn.seat }]);
        }
      }
      events.push({ type: "ALLOCATION_COMMITTED", payload: {}, actor: turn.seat });
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
      // The zero-success (whiff) bump is applied immediately at the conclusion of the
      // whiffing action (see gmWhiffEvent), not here at end of round.
      const { threats, log } = reinforce({ threats: state.board.threats, reducedToZeroThisRound: reducedToZero, roller: deps.roller });
      return ok([
        { type: "REINFORCEMENTS_APPLIED", payload: { threats, log } },
        { type: "ROUND_ENDED", payload: {} },
      ]);
    }

    case "rust_curse": {
      // Rust-Witch 'Rust Curse' (rulebook p56): the GM names the cursed PC; the server picks
      // one of that PC's items at random (anti-fudge, replayable — like injuries) and rusts it.
      if (!rustWitchInPlay(state)) return err("no Rust-Witch is in play");
      const pool = degradableEquipment(state, intent.seat);
      if (pool.length === 0) return err("that character has no equipment left to rust");
      const roll = deps.roller.roll(1)[0]!;
      const pick = pool[(roll - 1) % pool.length]!;
      return ok([{ type: "EQUIPMENT_DEGRADED", payload: { seat: intent.seat, itemId: pick.id, itemName: pick.name, roll } }]);
    }

    case "change_blood":
      return ok([{ type: "BLOOD_CHANGED", payload: { seat: intent.seat, delta: intent.delta, ...(intent.reason ? { reason: intent.reason } : {}) }, actor: intent.seat }]);
    case "share_blood":
      return ok([{ type: "BLOOD_SHARED", payload: { from: intent.from, to: intent.to, amount: intent.amount }, actor: intent.from }]);
    case "heal":
      return ok([{ type: "HEALED", payload: { seat: intent.seat, category: intent.category, box: intent.box }, actor: intent.seat }]);
    case "mark_injury": {
      // A manual correction (no GM die, no Blood) — mirrors the resolution path's
      // INJURY_MARKED so a 2nd box still records its penalty for replay/audit.
      const penalty = intent.box === 2 ? penaltyLabel(intent.seat, intent.category) : undefined;
      return ok([{ type: "INJURY_MARKED", payload: { seat: intent.seat, category: intent.category, box: intent.box, ...(penalty ? { penalty } : {}) }, actor: intent.seat }]);
    }
    case "use_power": {
      // No-die active used from the sheet (Tethered Phantom / Hellish Screech, #35): spend the power's
      // Blood and drop a chosen Objective/Threat's Challenge by the descriptor amount, routed through
      // lowerChallenge so the Werhund's 'Unlowerable Challenge' (#25) holds. Tethered Phantom's drop is
      // round-scoped (`temporary`, restored at ROUND_ENDED); Hellish Screech's is permanent. A locked
      // advance has no descriptor → the lookup fails (anti-fudge), and a no-op drop spends no Blood.
      const seat = intent.seat;
      const power = sheetChallengePower(state, seat, intent.powerId);
      const reduction = power?.sheetChallengeReduction;
      if (!power || !reduction) return err("no such power available");
      const cost = power.bloodCost ?? 0;
      if ((state.characters[seat]?.blood ?? 0) < cost) return err("not enough Blood");
      const target: Target | undefined =
        reduction.scope === "threat"
          ? state.board.threats.find((t) => t.id === intent.targetId)
          : state.board.objectives.find((o) => o.id === intent.targetId) ?? state.board.threats.find((t) => t.id === intent.targetId);
      if (!target) return err("pick a valid target");
      const current = target.challenge ?? 0;
      const next = lowerChallenge(target, reduction.amount);
      // No actual drop (already 0, or a Werhund's locked Challenge) → the active does nothing and costs
      // no Blood. Mirrors Sapper emitting NOTHING through the same gate (no phantom CHALLENGE_REDUCED).
      if (next >= current) return err("that target's Challenge can't be lowered");
      const events: EventInput[] = [
        {
          type: "CHALLENGE_REDUCED",
          payload: { targetId: target.id, targetName: target.name, targetKind: target.kind, amount: reduction.amount, challenge: next, powerId: power.id, powerName: power.name, ...(reduction.expiresAtRoundEnd ? { temporary: true } : {}) },
          actor: seat,
        },
      ];
      if (cost > 0) events.push({ type: "BLOOD_CHANGED", payload: { seat, delta: -cost, reason: power.name }, actor: seat });
      return ok(events);
    }
    case "set_stance": {
      // Arm a cross-turn stance from the sheet (Iryna's Hell's Ravenous Fire / Enervation of the Soul /
      // Mantle of the Fell Beast, #36): spend the power's Blood and park an ActiveStance. A locked advance
      // has no descriptor → the lookup fails (anti-fudge). Re-arming a stance you already hold is rejected
      // so the Blood isn't double-charged (Mantle: only an ACTIVE Mantle blocks — a spent one whose
      // Objective is done can be re-cast on a new Objective).
      const seat = intent.seat;
      const power = stancePower(state, seat, intent.powerId);
      const spec = power?.setsStance;
      if (!power || !spec) return err("no such power available");
      const cost = power.bloodCost ?? 0;
      if ((state.characters[seat]?.blood ?? 0) < cost) return err("not enough Blood");
      const held = state.characters[seat]?.stances ?? [];
      const alreadyHeld =
        spec.kind === "mantle"
          ? activeMantle(state.characters[seat], state.board.objectives) !== undefined
          : held.some((s) => s.kind === spec.kind);
      if (alreadyHeld) return err("that stance is already active");
      // Mantle binds to the Objective whose completion ends it (rulebook p57).
      let objectiveId: string | undefined;
      let objectiveName: string | undefined;
      if (spec.kind === "mantle") {
        const obj = state.board.objectives.find((o) => o.id === intent.objectiveId && o.rating > 0);
        if (!obj) return err("pick an Objective to bind the Mantle to");
        objectiveId = obj.id;
        objectiveName = obj.name;
      }
      const events: EventInput[] = [
        {
          type: "STANCE_SET",
          payload: {
            seat,
            kind: spec.kind,
            powerId: power.id,
            powerName: power.name,
            ...(spec.damage !== undefined ? { damage: spec.damage } : {}),
            ...(spec.highStats ? { highStats: spec.highStats } : {}),
            ...(spec.highValue !== undefined ? { highValue: spec.highValue } : {}),
            ...(spec.lowValue !== undefined ? { lowValue: spec.lowValue } : {}),
            ...(spec.blocksItems ? { blocksItems: true } : {}),
            ...(objectiveId ? { objectiveId, objectiveName } : {}),
          },
          actor: seat,
        },
      ];
      if (cost > 0) events.push({ type: "BLOOD_CHANGED", payload: { seat, delta: -cost, reason: power.name }, actor: seat });
      return ok(events);
    }
    case "use_equipment": {
      const events: EventInput[] = [{ type: "EQUIPMENT_USED", payload: { seat: intent.seat, itemId: intent.itemId }, actor: intent.seat }];
      // Reactive economy gear (Iryna's cigarettes → +Blood) applies its effect here, not
      // manually — so the use grants the Blood wherever it's fired (sheet or injury beat).
      // Only when a use is actually available, so a depleted item can't mint free Blood.
      const item = findEquipment(state, intent.seat, intent.itemId);
      const remaining = state.characters[intent.seat]?.equipmentUses[intent.itemId];
      const usable = remaining === undefined || remaining > 0;
      if (usable && item?.reactive?.blood) {
        events.push({ type: "BLOOD_CHANGED", payload: { seat: intent.seat, delta: item.reactive.blood, reason: item.name }, actor: intent.seat });
      }
      return ok(events);
    }
    case "restore_equipment": {
      // Click-to-remove on the sheet: hand back one spent use, up to the item's max.
      // No-op once the item is already full so it can't mint phantom uses (or, for
      // reactive economy gear, phantom Blood). For reactive-Blood items the restore is
      // a clean undo of the use, so it returns the Blood too — keeping spend⇄restore symmetric.
      const item = findEquipment(state, intent.seat, intent.itemId);
      const remaining = state.characters[intent.seat]?.equipmentUses[intent.itemId];
      if (remaining === undefined || item?.uses === undefined || remaining >= item.uses) return ok([]);
      const events: EventInput[] = [{ type: "EQUIPMENT_RESTORED", payload: { seat: intent.seat, itemId: intent.itemId }, actor: intent.seat }];
      if (item.reactive?.blood) {
        events.push({ type: "BLOOD_CHANGED", payload: { seat: intent.seat, delta: -item.reactive.blood, reason: `${item.name} (returned)` }, actor: intent.seat });
      }
      return ok(events);
    }
    case "loot_add":
      return ok([{ type: "LOOT_ADDED", payload: { seat: intent.seat, item: intent.item }, actor: intent.seat }]);
    case "loot_activate":
      return ok([{ type: "LOOT_ACTIVATED", payload: { seat: intent.seat, itemId: intent.itemId }, actor: intent.seat }]);
    case "unlock_advance":
      return ok([{ type: "ADVANCE_UNLOCKED", payload: { seat: intent.seat, advanceId: intent.advanceId }, actor: intent.seat }]);
    case "trigger_flashback": {
      // A flashback is a one-per-session *reroll* the player calls on a weak roll (RULES §9,
      // rulebook p41), so it only makes sense in the roll window: after the player has cast
      // their dice, before the discard locks the result in. We validate the moment here
      // rather than trusting the UI — the offer is surfaced on the roll-results screen.
      const turn = state.currentTurn;
      if (!turn || turn.seat !== intent.seat) return err("you can only flashback on your own turn");
      if (!turn.playerDice || turn.survivors || turn.pendingInjury || turn.lastStand) {
        return err("a flashback can only be cut on the roll, before the discard");
      }
      if (!state.session.active) return err("the session hasn't started");
      if (state.characters[intent.seat]?.flashbackUsedThisSession) return err("flashback already used this session");
      if (!flashbackTriggerable(turn.playerDice)) return err("a flashback needs a roll of 2 successes or fewer");
      // Add 2 dice to the pool and reroll the *whole* thing — the second result stands. The
      // reroll overwrites the player dice (a fresh DICE_ROLLED), so the table drops straight
      // back onto the results screen with the new throw; the Reich's dice, if rolled, stand.
      const results = deps.roller.roll(turn.playerDice.length + FLASHBACK_BONUS_DICE);
      return ok([
        { type: "FLASHBACK_TRIGGERED", payload: { seat: intent.seat }, actor: intent.seat },
        { type: "DICE_ROLLED", payload: { who: "player", results }, actor: intent.seat },
      ]);
    }

    case "gm_override":
      return ok([{ type: "GM_OVERRIDE", payload: { ...(intent.note ? { note: intent.note } : {}), ...(intent.patch ? { patch: intent.patch } : {}) } }]);

    default:
      return err(`unknown intent: ${(intent as { kind: string }).kind}`);
  }
}
