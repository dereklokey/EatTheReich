import type { GameState } from "@shared/state/types.js";
import type { CharId, SeatId } from "@shared/events/types.js";
import { CHAR_IDS } from "@shared/events/types.js";
import { sceneComplete } from "@shared/domain/types.js";
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
  onView,
}: {
  state: GameState;
  mySeat: SeatId | null;
  /** The character whose Composer is open right now (pre-roll), or null. */
  composingSeat: CharId | null;
  /** Open the composer for this character (the player's own seat, or any seat for the GM). */
  onCompose: (seat: CharId) => void;
  /** Opt in to watch the active player's pre-roll selection live (issue #47). Provided only to
   *  non-drivers — Game passes it as undefined for the device that owns the open Composer. */
  onView?: () => void;
}) {
  if (state.currentTurn || !mySeat) return null;

  // Someone has the Composer open but hasn't rolled yet: hold the floor. Everyone sees who
  // it is; nobody else gets a start button until they roll, cancel, or drop (RULES §1 — one
  // turn resolves at a time). The active prepper has the full-screen Composer over this anyway.
  if (composingSeat) {
    return (
      <div className="paper paper-tight flex items-center gap-2">
        <span className="dot dot-online" />
        <span className="mono text-sm flex-1">
          <b className="hl">{seatName(composingSeat)}</b> is taking a turn…
        </span>
        {/* "View" opts this watcher into the active player's pre-roll selection (issue #47); the
            roll itself stays auto-visible to all whether or not they watched the prep. */}
        {onView && (
          <button
            className="display text-paper bg-dusk-mauve px-3 py-1 text-sm"
            style={{ borderRadius: 2 }}
            onClick={onView}
            title="Watch the pre-roll selection live"
          >
            View
          </button>
        )}
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

  // Scene over (issue #48): once the primary objective is complete the scene ends (rulebook p38),
  // so no one takes another turn. Hard-gate the start buttons and say why — the GM reopens play by
  // framing a new objective. (The GM's own escape hatch is the reinforcements override, §0.)
  if (sceneComplete(state.board.objectives)) {
    if (startable.length === 0) return null;
    return (
      <div className="paper paper-tight mono text-xs text-paper-fade">
        Primary objective complete — the scene is over.
        {mySeat === "gm" ? " Frame a new objective to continue." : ""}
      </div>
    );
  }

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
