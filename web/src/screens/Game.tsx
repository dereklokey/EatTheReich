import { useState } from "react";
import { useGame } from "@/net/useGame";
import { useEffects } from "@/effects/EffectsContext";
import { SeatPick } from "./SeatPick";
import { Board } from "./Board";
import { SafetyBar, XCardOverlay } from "./SafetyBar";
import { Theater } from "@/theater/Theater";
import { TurnControls } from "@/theater/TurnControls";
import { GMPanel } from "@/gm/GMPanel";
import { CharacterSheet } from "@/sheet/CharacterSheet";
import { CHAR_IDS, type CharId } from "@shared/events/types.js";

/**
 * In-game shell: connects to the room, then routes to seat-pick (until this device
 * owns a seat) or the board. The safety bar + X-Card overlay are always mounted, one
 * tap away, per CLAUDE.md §2 / DESIGN.md §8. The GM gets a slide-over GM panel; the
 * resolution theater overlays everything while a turn is in progress.
 */
export function Game({ code, onExit }: { code: string; onExit: () => void }) {
  const game = useGame(code);
  const { reduced, toggle } = useEffects();
  const isGm = game.mySeat === "gm";
  const ownChar = game.mySeat && CHAR_IDS.includes(game.mySeat as CharId) ? (game.mySeat as CharId) : null;
  const [gmOpen, setGmOpen] = useState(false);
  const [sheetSeat, setSheetSeat] = useState<CharId | null>(null);

  return (
    <div className="min-h-full">
      <TopBar
        code={code}
        status={game.status}
        seatLabel={game.mySeat ?? null}
        reduced={reduced}
        isGm={isGm}
        onOpenGm={() => setGmOpen(true)}
        onOpenSheet={ownChar ? () => setSheetSeat(ownChar) : undefined}
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
        <>
          <TurnControls state={game.state} send={game.send} mySeat={game.mySeat} />
          <Board
            state={game.state}
            online={game.online}
            onOpenSheet={setSheetSeat}
            onFrameScene={isGm ? () => setGmOpen(true) : undefined}
          />
        </>
      )}

      {game.state?.currentTurn && <Theater state={game.state} send={game.send} mySeat={game.mySeat} />}
      {game.state && isGm && gmOpen && (
        <GMPanel state={game.state} send={game.send} events={game.events} onRewind={game.rewind} onClose={() => setGmOpen(false)} />
      )}
      {game.state && sheetSeat && (
        <CharacterSheet
          seat={sheetSeat}
          state={game.state}
          send={game.send}
          canEdit={game.mySeat === sheetSeat || isGm}
          onClose={() => setSheetSeat(null)}
        />
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
  isGm,
  onOpenGm,
  onOpenSheet,
  onToggleEffects,
  onExit,
}: {
  code: string;
  status: string;
  seatLabel: string | null;
  reduced: boolean;
  isGm: boolean;
  onOpenGm: () => void;
  onOpenSheet?: () => void;
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

        {isGm && (
          <button className="display text-paper bg-blood px-2 py-0.5 text-sm ml-auto" style={{ borderRadius: 2 }} onClick={onOpenGm}>
            GM
          </button>
        )}
        {onOpenSheet && (
          <button className={`display text-paper bg-dusk-mauve px-2 py-0.5 text-sm ${isGm ? "" : "ml-auto"}`} style={{ borderRadius: 2 }} onClick={onOpenSheet}>
            Sheet
          </button>
        )}
        <button className={`mono text-xs text-paper-fade underline ${isGm || onOpenSheet ? "" : "ml-auto"}`} onClick={onToggleEffects}>
          effects: {reduced ? "reduced" : "full"}
        </button>
        <button className="mono text-xs text-paper-fade underline" onClick={onExit}>
          exit
        </button>
      </div>
    </div>
  );
}
