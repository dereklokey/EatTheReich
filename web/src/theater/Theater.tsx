import type { GameState } from "@shared/state/types.js";
import type { Intent } from "@shared/protocol/messages.js";
import type { Allocation } from "@shared/engine/allocate.js";
import type { PoolSource } from "@shared/engine/playerPool.js";
import type { SeatId } from "@shared/events/types.js";
import { seatName } from "@/game/seats";
import { PoolBuilder } from "./PoolBuilder";
import { RollReveal } from "./RollReveal";
import { AllocationTray } from "./AllocationTray";
import "./theater.css";

/**
 * The resolution theater (DESIGN.md §6) — the one screen everyone watches. It mounts
 * whenever a turn is in progress and walks the table through the RULES §4 pipeline,
 * branching on what the server has recorded so far (no client-side phase guessing):
 *   no player dice  → build + roll
 *   dice, no survivors → reveal + resolve discard
 *   survivors         → allocate + commit
 * Only the active player and the GM get the controls; everyone else watches live.
 */
export function Theater({
  state,
  send,
  mySeat,
}: {
  state: GameState;
  send: (i: Intent) => void;
  mySeat: SeatId | null;
}) {
  const turn = state.currentTurn;
  if (!turn) return null;
  const char = state.characters[turn.seat];
  const canDrive = mySeat === turn.seat || mySeat === "gm";

  const onRoll = (dice: number, sources: PoolSource[], spendItemIds: string[]) => {
    for (const itemId of spendItemIds) send({ kind: "use_equipment", seat: turn.seat, itemId });
    send({ kind: "roll", playerPoolDice: dice, sources });
  };

  const onLockIn = (allocations: Allocation[]) => {
    send({ kind: "allocate", allocations });
    send({ kind: "commit" });
  };

  return (
    <div className="theater">
      <div className="theater__inner">
        <div className="flex items-baseline justify-between">
          <h2 className="display text-2xl text-paper">
            {seatName(turn.seat)}’s turn
          </h2>
          <span className="mono text-xs text-paper-fade">
            {turn.stat ?? "—"}
            {turn.engagedThreatIds.length > 0 && ` · vs ${turn.engagedThreatIds.length} threat${turn.engagedThreatIds.length === 1 ? "" : "s"}`}
          </span>
        </div>

        <div className="mt-4">
          {!turn.playerDice ? (
            <PoolBuilder turn={turn} char={char} canDrive={canDrive} onRoll={onRoll} />
          ) : !turn.survivors ? (
            <RollReveal turn={turn} canDrive={canDrive} onResolve={() => send({ kind: "resolve_discard" })} />
          ) : (
            <AllocationTray turn={turn} state={state} char={char} canDrive={canDrive} onLockIn={onLockIn} />
          )}
        </div>

        {!canDrive && (
          <p className="mono text-xs text-paper-fade mt-6 text-center">
            Watching {seatName(turn.seat)} — the active player and GM drive this turn.
          </p>
        )}
      </div>
    </div>
  );
}
