import { useState } from "react";
import type { GameState } from "@shared/state/types.js";
import type { Intent } from "@shared/protocol/messages.js";
import type { CharId, SeatId } from "@shared/events/types.js";
import { CHAR_IDS } from "@shared/events/types.js";
import { seatName } from "@/game/seats";
import { DeclareModal } from "./DeclareModal";

/**
 * Launches a turn (RULES §1 — characters act in any order, once per round). A seated
 * player starts their own turn; the GM can start any character's. Declaring sends
 * `start_turn`, which opens the theater. Hidden while a turn is already in progress.
 */
export function TurnControls({
  state,
  send,
  mySeat,
}: {
  state: GameState;
  send: (i: Intent) => void;
  mySeat: SeatId | null;
}) {
  const [declaring, setDeclaring] = useState<CharId | null>(null);
  if (state.currentTurn || !mySeat) return null;

  const acted = (id: CharId) => state.actedThisRound.includes(id);
  const playable = (id: CharId) => !state.characters[id]?.dead && !acted(id);

  const startable: CharId[] =
    mySeat === "gm"
      ? CHAR_IDS.filter((id) => state.seats[id]?.claimed && playable(id))
      : CHAR_IDS.includes(mySeat as CharId) && playable(mySeat as CharId)
        ? [mySeat as CharId]
        : [];

  if (startable.length === 0) return null;

  return (
    <div className="mx-auto max-w-5xl px-4 mt-3">
      <div className="paper paper-tight flex flex-wrap items-center gap-2">
        <span className="mono text-xs text-paper-fade">
          {mySeat === "gm" ? "Start a turn:" : "Your move:"}
        </span>
        {startable.map((id) => (
          <button
            key={id}
            className="display text-paper bg-blood px-3 py-1 text-sm"
            style={{ borderRadius: 2 }}
            onClick={() => setDeclaring(id)}
          >
            {mySeat === "gm" ? seatName(id) : "Take your turn"}
          </button>
        ))}
      </div>

      {declaring && (
        <DeclareModal
          seat={declaring}
          state={state}
          onCancel={() => setDeclaring(null)}
          onConfirm={(decl) => {
            send({ kind: "start_turn", seat: declaring, ...decl });
            setDeclaring(null);
          }}
        />
      )}
    </div>
  );
}
