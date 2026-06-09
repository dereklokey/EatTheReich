import type { GameState } from "@shared/state/types.js";
import type { CharId, SeatId } from "@shared/events/types.js";
import { CHAR_IDS } from "@shared/events/types.js";
import { seatName } from "@/game/seats";

/**
 * Launches a turn (RULES §1 — characters act in any order, once per round). A seated
 * player starts their own turn; the GM can start any character's. Picking a character
 * opens the Turn Composer (DECLARE + BUILD_PLAYER_POOL); the roll fires from there.
 * Hidden while a turn is already in progress — and, once someone opens their Composer,
 * replaced for everyone else by a "taking a turn" banner so two people don't start at
 * once during the pre-roll gap (composingSeat is the transient §3A signal from the room).
 */
export function TurnControls({
  state,
  mySeat,
  composingSeat,
  onCompose,
}: {
  state: GameState;
  mySeat: SeatId | null;
  /** The character whose Composer is open right now (pre-roll), or null. */
  composingSeat: CharId | null;
  /** Open the composer for this character (the player's own seat, or any seat for the GM). */
  onCompose: (seat: CharId) => void;
}) {
  if (state.currentTurn || !mySeat) return null;

  // Someone has the Composer open but hasn't rolled yet: hold the floor. Everyone sees who
  // it is; nobody else gets a start button until they roll, cancel, or drop (RULES §1 — one
  // turn resolves at a time). The active prepper has the full-screen Composer over this anyway.
  if (composingSeat) {
    return (
      <div className="paper paper-tight flex items-center gap-2">
        <span className="dot dot-online" />
        <span className="mono text-sm">
          <b className="hl">{seatName(composingSeat)}</b> is taking a turn…
        </span>
      </div>
    );
  }

  const acted = (id: CharId) => state.actedThisRound.includes(id);
  const playable = (id: CharId) => !state.characters[id]?.dead && !acted(id);

  const startable: CharId[] =
    mySeat === "gm"
      ? CHAR_IDS.filter((id) => state.seats[id]?.claimed && playable(id))
      : CHAR_IDS.includes(mySeat as CharId) && playable(mySeat as CharId)
        ? [mySeat as CharId]
        : [];

  if (startable.length === 0) return null;

  // Rendered inside the board's main column (Game passes this as Board's `turnControls`
  // slot), so it lines up over the scene/objectives/threats — not over the crew rail.
  return (
    <div className="paper paper-tight flex flex-wrap items-center gap-2">
      <span className="mono text-xs text-paper-fade">
        {mySeat === "gm" ? "Start a turn:" : "Your move:"}
      </span>
      {startable.map((id) => (
        <button
          key={id}
          className="display text-paper bg-blood px-3 py-1 text-sm"
          style={{ borderRadius: 2 }}
          onClick={() => onCompose(id)}
        >
          {mySeat === "gm" ? seatName(id) : "Take your turn"}
        </button>
      ))}
    </div>
  );
}
