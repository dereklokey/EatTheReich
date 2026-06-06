import type { GameState } from "@shared/state/types.js";
import type { Intent } from "@shared/protocol/messages.js";
import type { Allocation } from "@shared/engine/allocate.js";
import type { PoolSource } from "@shared/engine/playerPool.js";
import type { SeatId } from "@shared/events/types.js";
import { seatName } from "@/game/seats";
import { PoolBuilder, type BloodSpend } from "./PoolBuilder";
import { RollReveal } from "./RollReveal";
import { AllocationTray } from "./AllocationTray";
import { InjuryCheck } from "./InjuryCheck";
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
  onMinimize,
}: {
  state: GameState;
  send: (i: Intent) => void;
  mySeat: SeatId | null;
  /** Collapse the theater locally to peek at the board/sheets (the turn stays live). */
  onMinimize: () => void;
}) {
  const turn = state.currentTurn;
  if (!turn) return null;
  const char = state.characters[turn.seat];
  const canDrive = mySeat === turn.seat || mySeat === "gm";

  const onRoll = (dice: number, sources: PoolSource[], spendItemIds: string[], bloodSpends: BloodSpend[]) => {
    for (const itemId of spendItemIds) send({ kind: "use_equipment", seat: turn.seat, itemId });
    for (const s of bloodSpends) send({ kind: "change_blood", seat: turn.seat, delta: -s.amount, reason: s.reason });
    send({ kind: "roll", playerPoolDice: dice, sources });
  };

  const onLockIn = (allocations: Allocation[]) => {
    send({ kind: "allocate", allocations });
    send({ kind: "commit" });
  };

  const onAddDice = (count: number, label?: string) => send({ kind: "add_bonus_dice", count, ...(label ? { label } : {}) });

  return (
    <div className="theater">
      <div className="theater__inner">
        <div className="flex items-center gap-3">
          <h2 className="display text-2xl text-paper flex-1">
            {seatName(turn.seat)}’s turn
            <span className="mono text-xs text-paper-fade ml-2">
              {turn.stat ?? "—"}
              {turn.engagedThreatIds.length > 0 && ` · vs ${turn.engagedThreatIds.length} threat${turn.engagedThreatIds.length === 1 ? "" : "s"}`}
            </span>
          </h2>
          {canDrive && (
            <button
              className="mono text-xs underline text-paper-fade"
              title="Abort this turn — it won't count as your action"
              onClick={() => send({ kind: "cancel_turn" })}
            >
              cancel turn
            </button>
          )}
          <button
            className="mono text-sm px-2 py-1 bg-night-top text-paper border border-paper-shadow/40"
            style={{ borderRadius: 3 }}
            title="Look at the board / sheets — the turn stays live"
            onClick={onMinimize}
          >
            ▾ peek
          </button>
        </div>

        <div className="mt-4">
          {turn.pendingInjury ? (
            <InjuryCheck turn={turn} state={state} canDrive={canDrive} send={send} />
          ) : !turn.playerDice ? (
            <PoolBuilder turn={turn} char={char} canDrive={canDrive} isGM={mySeat === "gm"} onRoll={onRoll} />
          ) : !turn.survivors ? (
            <RollReveal turn={turn} canDrive={canDrive} onResolve={() => send({ kind: "resolve_discard" })} />
          ) : (
            <AllocationTray turn={turn} state={state} char={char} canDrive={canDrive} onLockIn={onLockIn} onAddDice={onAddDice} />
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
