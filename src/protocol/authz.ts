import type { GameState } from "../state/types.js";
import type { SeatId } from "../events/types.js";
import type { Intent } from "./messages.js";

/**
 * Seat-scoped authorization (CLAUDE.md §3.6: "Interaction is seat-scoped"). This is
 * an access-control boundary, NOT the game rules — it's orthogonal to §0's
 * "suggest, don't enforce" (which is about dice/injury math the GM may override).
 * Here we decide *who* a connection is allowed to act as, which is a hard anti-fudge
 * line: a player must not be able to spend another player's Blood or drive the GM's
 * panel just by sending a different `actor`.
 *
 * The authority is the connection's **authenticated seat** (`connSeat`), derived by
 * the DO from the socket's claimed/reclaimed seat — never trusted from the message
 * body. `null` means an un-seated connection (lobby / spectator).
 *
 * Policy:
 *  - GM may do anything.
 *  - An un-seated connection may only create/join/claim and use the safety tools.
 *  - A player may use the safety tools, act on **their own** seat, and drive **their
 *    own** turn — nothing else (board/threat/objective/session control is GM-only).
 */

export type Authorization = { ok: true } | { ok: false; error: string };

const allow: Authorization = { ok: true };
const deny = (error: string): Authorization => ({ ok: false, error });

/**
 * Intents anyone (including spectators) may send — the safety tooling is universal
 * (§2, DESIGN.md §8). Lines/Veils/calibration (`set_safety`) belong here too: every
 * participant is responsible for the table's safety (rulebook p6), so anyone may
 * record a Line or Veil during Session 0 or mid-game, not just the GM.
 */
const SAFETY_INTENTS = new Set<Intent["kind"]>([
  "raise_xcard",
  "clear_xcard",
  "traffic_signal",
  "set_safety",
]);

/** Intents an un-seated connection may send to get into the game. */
const LOBBY_INTENTS = new Set<Intent["kind"]>(["create_game", "claim_seat"]);

/**
 * Turn-driving intents: allowed for the player whose turn is in progress (or GM).
 * `roll_gm` is deliberately NOT here — the Reich's roll is the GM's beat (issue #5),
 * so it falls through to the GM-only default below. Don't add it.
 */
const TURN_INTENTS = new Set<Intent["kind"]>([
  "roll",
  "resolve_discard",
  "allocate",
  "add_bonus_dice",
  "scavenge",
  "commit",
  "roll_injury",
  "resolve_injury",
  "cancel_turn",
  "last_stand_roll",
  "last_stand_commit",
]);

/** The seat an intent acts upon, if it's self-scoped; otherwise undefined. */
function subjectSeat(intent: Intent): SeatId | undefined {
  switch (intent.kind) {
    case "start_turn":
    case "freeform_roll": // out-of-turn roll on your own sheet (issue #17); GM rolls the Reich's via seat "gm"
    case "change_blood":
    case "heal":
    case "mark_injury":
    case "use_power": // a no-die active on your own sheet (Tethered Phantom / Hellish Screech, #35)
    case "set_stance": // arm a cross-turn stance on your own sheet (Iryna's #36 actives)
    case "use_equipment":
    case "restore_equipment":
    case "loot_activate": // the owner activates their own loot; granting (loot_add) is GM-only
    case "unlock_advance":
    case "relock_advance":
    case "trigger_flashback":
      return intent.seat;
    case "share_blood":
      return intent.from; // you may give away your own Blood
    case "claim_seat":
    case "release_seat":
      return intent.seat;
    default:
      return undefined;
  }
}

export function authorizeIntent(
  state: GameState,
  connSeat: SeatId | null,
  intent: Intent,
): Authorization {
  // Safety tooling is one tap away for everyone, always (§2).
  if (SAFETY_INTENTS.has(intent.kind)) return allow;

  // The GM seat may act on anything (§3.6).
  if (connSeat === "gm") return allow;

  // Un-seated (lobby / spectator): may only create or claim a seat.
  if (connSeat === null) {
    return LOBBY_INTENTS.has(intent.kind)
      ? allow
      : deny("claim a seat before acting");
  }

  // A seated player from here on.
  // Turn-driving intents require it to be this player's turn.
  if (TURN_INTENTS.has(intent.kind)) {
    return state.currentTurn?.seat === connSeat
      ? allow
      : deny("not your turn");
  }

  // Self-scoped intents: the subject seat must be this player's.
  const subject = subjectSeat(intent);
  if (subject !== undefined) {
    // A player can release their own seat, but claiming is a lobby action (they're
    // already seated) so claim_seat by a seated player is rejected here.
    if (intent.kind === "claim_seat") return deny("you already hold a seat");
    return subject === connSeat ? allow : deny("you can only act on your own character");
  }

  // Everything else (board/threats/objectives/session/reinforcement/override) is GM-only.
  return deny("only the GM can do that");
}
