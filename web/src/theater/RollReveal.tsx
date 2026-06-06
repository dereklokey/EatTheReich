import { useEffect, useRef, useState } from "react";
import type { TurnState } from "@shared/state/types.js";
import type { DieFace } from "@shared/domain/types.js";
import { Die, tiltFor, type DieVisualState } from "@/components/dice/Die";
import { useEffects } from "@/effects/EffectsContext";

/**
 * ROLL → reveal (RULES §4, DESIGN.md §6). The dice land with a concussion (shake +
 * muzzle bloom), then values resolve: successes (4–5) flare hazard-yellow, the crit
 * (6) detonates crimson, sub-threshold dice are about to be discarded. The active
 * player/GM then resolves the discard (which also fires pre-discard passives).
 */
function playerState(face: DieFace): DieVisualState {
  if (face === 6) return "critical";
  if (face >= 4) return "success";
  return "normal";
}

export function RollReveal({
  turn,
  canDrive,
  onResolve,
}: {
  turn: TurnState;
  canDrive: boolean;
  onResolve: () => void;
}) {
  const { reduced } = useEffects();
  const [boom, setBoom] = useState(!reduced);
  const seen = useRef(false);

  useEffect(() => {
    if (seen.current || reduced) return;
    seen.current = true;
    const t = setTimeout(() => setBoom(false), 500);
    return () => clearTimeout(t);
  }, [reduced]);

  const player = turn.playerDice ?? [];
  const gm = turn.gmDice ?? [];
  const gmHits = gm.filter((f) => f >= 4).length;

  return (
    <div>
      <div className="theater__phase text-sm">The roll</div>

      <div className={`relative mt-3 ${boom ? "shake" : ""}`}>
        {boom && <span className="flash-bloom" />}
        <div className="mono text-xs text-paper-fade mb-1">Your dice</div>
        <div className="tray">
          {player.map((face, i) => (
            <Die key={i} kind="player" value={face} state={playerState(face)} tilt={tiltFor(i)} entering={!reduced} />
          ))}
        </div>
      </div>

      <div className="mt-5">
        <div className="mono text-xs text-paper-fade mb-1">
          The Reich’s dice — <span className="text-blood">{gmHits} success{gmHits === 1 ? "" : "es"}</span>
        </div>
        <div className="tray">
          {gm.map((face, i) => (
            <Die key={i} kind="gm" value={face} state={face >= 4 ? "success" : "normal"} tilt={tiltFor(i + 3)} entering={!reduced} />
          ))}
        </div>
      </div>

      {canDrive && (
        <button className="detonator mt-6" onClick={onResolve}>
          Discard &amp; resolve
        </button>
      )}
    </div>
  );
}
