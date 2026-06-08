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
  LAST_STAND_DICE,
} from "../engine/index.js";
import { CHARACTERS_BY_ID } from "../data/characters.js";
import { flashbackTriggerable, FLASHBACK_BONUS_DICE } from "../data/flashbacks.js";
import { threatInPlay, anathemaInPlay, rendingClawsInPlay } from "../domain/types.js";
import type { DieFace } from "../domain/types.js";
import type { Equipment } from "../domain/character.js";

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
 * The flat rating damage a SPECIAL inflicts on a chosen Threat (Astrid's Apex Predator → 3;
 * rulebook p57). Same sheet lookup as {@link specialBloodGrant}, for the `reduceThreatRating`
 * descriptor. Computed server-side so the carried `ratingDamage` is authoritative (anti-fudge),
 * not trusted from the client allocation. The effect rides the DIE_ALLOCATED through the engine
 * (bypasses Challenge, rating 0 → Attack 0), so no separate event is needed.
 */
function specialRatingReduction(state: GameState, seat: CharId, specialId: string): number | undefined {
  const sheet = CHARACTERS_BY_ID[seat];
  if (!sheet) return undefined;
  const unlocked = state.characters[seat]?.unlockedAdvances ?? [];
  const power =
    sheet.abilities.find((p) => p.id === specialId) ??
    sheet.advances.find((p) => p.id === specialId && unlocked.includes(p.id));
  return power?.reduceThreatRating;
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
    case "update_secondary_objective":
      return ok([{ type: "SECONDARY_OBJECTIVE_UPDATED", payload: { id: intent.id, patch: intent.patch } }]);
    case "complete_secondary_objective":
      return ok([{ type: "SECONDARY_OBJECTIVE_COMPLETED", payload: { id: intent.id, ...(intent.rewardChoice ? { rewardChoice: intent.rewardChoice } : {}) } }]);
    case "remove_secondary_objective":
      return ok([{ type: "SECONDARY_OBJECTIVE_REMOVED", payload: { id: intent.id } }]);
    case "set_loot_revealed":
      return ok([{ type: "SCENE_LOOT_REVEALED", payload: { name: intent.name, revealed: intent.revealed } }]);

    case "start_turn":
      return ok([{ type: "TURN_STARTED", payload: { seat: intent.seat, stat: intent.stat, ...(intent.tags ? { tags: intent.tags } : {}) }, actor: intent.seat }]);
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
      for (const a of intent.allocations) {
        // Apex Predator (#27): a sheet SPECIAL's flat rating damage is recomputed from the power
        // descriptor here (server-authoritative) and carried on DIE_ALLOCATED, so the engine
        // applies it (bypassing Challenge, rating 0 → Attack 0) — the client's value is ignored.
        const ratingDamage =
          a.kind === "special" && a.specialId && a.targetId ? specialRatingReduction(state, turn.seat, a.specialId) : undefined;
        events.push({
          type: "DIE_ALLOCATED",
          payload: { kind: a.kind, units: a.units, ...(a.targetId ? { targetId: a.targetId } : {}), ...(a.specialId ? { specialId: a.specialId } : {}), ...(ratingDamage ? { ratingDamage } : {}) },
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

    case "commit": {
      const turn = state.currentTurn;
      if (!turn) return err("no turn in progress");
      const leftover = turn.gmDiceRemaining ?? 0;
      // No GM die got through → no INJURY_CHECK; the turn just closes (no window flashes).
      // A GM whiff still presses the anchor Threat (+1 Attack) as the action concludes.
      if (leftover <= 0) {
        const whiff = gmWhiffEvent(state);
        return ok([...(whiff ? [whiff] : []), { type: "ALLOCATION_COMMITTED", payload: {}, actor: turn.seat }]);
      }

      // A die got through → open the INJURY_CHECK window WITHOUT rolling yet. The category
      // die is its own visible beat (`roll_injury`): the wounded vampire throws it across
      // the board, then it parks for the reveal + reaction window.
      return ok([{ type: "INJURY_CHECK_OPENED", payload: { seat: turn.seat }, actor: turn.seat }]);
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
        } else if (o.kind === "downed") {
          events.push({ type: "DOWNED", payload: { seat: turn.seat, category: o.category }, actor: turn.seat });
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
