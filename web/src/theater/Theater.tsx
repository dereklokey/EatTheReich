import type { ReactNode } from "react";
import type { GameState, TurnState } from "@shared/state/types.js";
import type { Intent } from "@shared/protocol/messages.js";
import type { Allocation } from "@shared/engine/allocate.js";
import type { SeatId } from "@shared/events/types.js";
import { flashbackTriggerable } from "@shared/data/flashbacks.js";
import { seatName } from "@/game/seats";
import { RollSequence } from "./RollSequence";
import { AllocationTray } from "./AllocationTray";
import { InjuryCheck } from "./InjuryCheck";
import "./theater.css";

/**
 * The resolution theater (DESIGN.md §6) — the one screen everyone watches. It mounts
 * whenever a turn is in progress and walks the table through the RULES §4 pipeline,
 * branching on what the server has recorded so far (no client-side phase guessing):
 *   no player dice  → the driver is still in the Turn Composer (private prep); watchers
 *                     see a calm "loading the action" beat until the dice are cast
 *   dice, no survivors → the roll itself: a staged craps-table throw over the live board
 *                        (RollSequence), ending in the results panel
 *   survivors         → allocate + commit
 * DECLARE + BUILD_PLAYER_POOL happen in the TurnComposer before the roll, so the theater
 * opens straight into the shared roll. Only the active player and GM get the controls.
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
  const cancel = () => send({ kind: "cancel_turn" });

  // The roll — player throw → Reich throw → results — is its own staged sequence. It plays
  // the dice over the live board (a transparent layer), only raising the dark results panel
  // once they've settled and faded, so it owns the whole screen rather than nesting here.
  if (turn.playerDice && !turn.survivors && !turn.pendingInjury) {
    // The flashback (RULES §9) is offered on the results screen, to the active player, only
    // when their own roll came up weak (≤2 successes) and it's still in hand this session.
    // The server re-validates; this just gates the affordance (issue #9).
    const canFlashback =
      mySeat === turn.seat &&
      state.session.active &&
      !char.flashbackUsedThisSession &&
      flashbackTriggerable(turn.playerDice);
    return (
      <RollSequence
        turn={turn}
        state={state}
        canDrive={canDrive}
        isGm={mySeat === "gm"}
        canFlashback={canFlashback}
        onFlashback={() => send({ kind: "trigger_flashback", seat: turn.seat })}
        onRollGm={() => send({ kind: "roll_gm" })}
        onResolve={() => send({ kind: "resolve_discard" })}
        onMinimize={onMinimize}
        onCancel={cancel}
      />
    );
  }

  // The injury check owns the whole screen too: its category die is thrown over the live
  // board (the arena), then it raises its own dark panel for the verdict — so it sits beside
  // the roll sequence, not nested in the shell here.
  if (turn.phase === "INJURY_CHECK") {
    return <InjuryCheck turn={turn} state={state} canDrive={canDrive} send={send} onMinimize={onMinimize} onCancel={cancel} />;
  }

  const onLockIn = (allocations: Allocation[]) => {
    send({ kind: "allocate", allocations });
    send({ kind: "commit" });
  };
  const onAddDice = (count: number, label?: string) =>
    send({ kind: "add_bonus_dice", count, ...(label ? { label } : {}) });

  return (
    <TheaterShell turn={turn} canDrive={canDrive} onMinimize={onMinimize} onCancel={cancel}>
      {!turn.playerDice ? (
        <div className="mt-6 text-center">
          <div className="theater__phase text-sm">Loading the action</div>
          <p className="mono text-sm text-paper-fade mt-3">
            {seatName(turn.seat)} is choosing a stat, gear, and targets…
          </p>
        </div>
      ) : (
        <AllocationTray turn={turn} state={state} char={char} canDrive={canDrive} onLockIn={onLockIn} onAddDice={onAddDice} />
      )}
    </TheaterShell>
  );
}

/**
 * The dark dossier panel that frames a resolution beat: the header (whose turn, the stat
 * and engagements, cancel/peek) over the night ground. Shared by the theater's branches
 * and by the roll sequence's results screen so they read as one continuous surface.
 */
export function TheaterShell({
  turn,
  canDrive,
  onMinimize,
  onCancel,
  children,
}: {
  turn: TurnState;
  canDrive: boolean;
  onMinimize: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <div className="theater">
      <div className="theater__inner">
        <div className="flex items-center gap-3">
          <h2 className="display text-2xl text-paper flex-1">
            {seatName(turn.seat)}’s turn
            <span className="mono text-xs text-paper-fade ml-2">
              {turn.stat ?? "—"}
              {turn.gmPoolSize !== undefined &&
                (turn.gmPoolSize > 0 ? ` · Reich rolls ${turn.gmPoolSize}` : " · uncontested")}
            </span>
          </h2>
          {canDrive && (
            <button
              className="mono text-xs underline text-paper-fade"
              title="Abort this turn — it won't count as your action"
              onClick={onCancel}
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

        <div className="mt-4">{children}</div>

        {!canDrive && (
          <p className="mono text-xs text-paper-fade mt-6 text-center">
            Watching {seatName(turn.seat)} — the active player and GM drive this turn.
          </p>
        )}
      </div>
    </div>
  );
}
