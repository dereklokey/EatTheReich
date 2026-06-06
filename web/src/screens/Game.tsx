import { useGame } from "@/net/useGame";
import { useEffects } from "@/effects/EffectsContext";
import { SeatPick } from "./SeatPick";
import { Board } from "./Board";
import { SafetyBar, XCardOverlay } from "./SafetyBar";

/**
 * In-game shell: connects to the room, then routes to seat-pick (until this device
 * owns a seat) or the board. The safety bar + X-Card overlay are always mounted, one
 * tap away, per CLAUDE.md §2 / DESIGN.md §8. The resolution theater and GM panel hang
 * off the board in the next increment.
 */
export function Game({ code, onExit }: { code: string; onExit: () => void }) {
  const game = useGame(code);
  const { reduced, toggle } = useEffects();
  const isGm = game.mySeat === "gm";

  return (
    <div className="min-h-full">
      <TopBar
        code={code}
        status={game.status}
        seatLabel={game.mySeat ?? null}
        reduced={reduced}
        onToggleEffects={toggle}
        onExit={onExit}
      />

      {!game.state ? (
        <div className="substrate grain min-h-[60vh] grid place-items-center">
          <p className="mono text-paper-fade">
            {game.status === "open" ? "syncing the war file…" : "reaching the room…"}
          </p>
        </div>
      ) : !game.mySeat ? (
        <SeatPick
          state={game.state}
          online={game.online}
          isGm={isGm}
          onClaim={game.claimSeat}
          onRelease={game.releaseSeat}
        />
      ) : (
        <Board state={game.state} online={game.online} />
      )}

      {game.state && <SafetyBar state={game.state} send={game.send} />}
      {game.state && <XCardOverlay state={game.state} send={game.send} />}

      {game.error && (
        <button
          className="fixed top-14 right-3 z-50 paper paper-tight mono text-sm text-blood text-left"
          onClick={game.clearError}
          title="dismiss"
        >
          {game.error}
        </button>
      )}
    </div>
  );
}

function TopBar({
  code,
  status,
  seatLabel,
  reduced,
  onToggleEffects,
  onExit,
}: {
  code: string;
  status: string;
  seatLabel: string | null;
  reduced: boolean;
  onToggleEffects: () => void;
  onExit: () => void;
}) {
  return (
    <div className="sticky top-0 z-40 bg-night-deep/95 border-b border-paper-shadow/30">
      <div className="mx-auto max-w-5xl flex items-center gap-3 px-4 py-2">
        <span className="mono text-xs text-paper-fade">code</span>
        <span className="display tracking-widest text-hazard text-lg">{code}</span>
        <span className={`dot ${status === "open" ? "dot-online" : "dot-away"}`} title={status} />
        {seatLabel && <span className="mono text-xs text-paper-fade">· you: {seatLabel}</span>}

        <button className="mono text-xs text-paper-fade ml-auto underline" onClick={onToggleEffects}>
          effects: {reduced ? "reduced" : "full"}
        </button>
        <button className="mono text-xs text-paper-fade underline" onClick={onExit}>
          exit
        </button>
      </div>
    </div>
  );
}
