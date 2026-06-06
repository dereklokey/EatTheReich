import type { TurnState } from "@shared/state/types.js";
import type { DieFace } from "@shared/domain/types.js";
import { Die, tiltFor, type DieVisualState } from "@/components/dice/Die";
import { useSound } from "@/effects/SoundContext";

/**
 * The results readout (RULES §4) — the calm, static panel the table lands on after the dice
 * have been thrown (RollSequence) or, under reduce-effects, in place of any throw. It shows
 * the settled pools with their successes/crit flares and the Reich's hit count, then the
 * driver resolves the discard. When the Reich hasn't rolled yet (the reduced two-beat), it
 * holds a poised tray and hands the GM the trigger.
 */
function playerState(face: DieFace): DieVisualState {
  if (face === 6) return "critical";
  if (face >= 4) return "success";
  return "normal";
}
function gmState(face: DieFace): DieVisualState {
  return face >= 4 ? "success" : "normal";
}

export function RollReveal({
  turn,
  canDrive,
  isGm,
  onRollGm,
  onResolve,
}: {
  turn: TurnState;
  canDrive: boolean;
  isGm: boolean;
  onRollGm: () => void;
  onResolve: () => void;
}) {
  const { play } = useSound();

  const player = turn.playerDice ?? [];
  const gm = turn.gmDice; // undefined until the GM rolls
  const gmPool = turn.gmPoolSize ?? 0;
  const gmHits = (gm ?? []).filter((f) => f >= 4).length;

  return (
    <div>
      <div className="theater__phase text-sm">The roll</div>

      <div className="mt-3">
        <div className="mono text-xs text-paper-fade mb-1">Your dice</div>
        <div className="tray">
          {player.map((face, i) => (
            <Die key={i} kind="player" value={face} state={playerState(face)} tilt={tiltFor(i)} />
          ))}
          {player.length === 0 && <span className="mono text-paper-fade italic">No dice in the pool.</span>}
        </div>
      </div>

      <div className="mt-5">
        {gm === undefined ? (
          <ReichPending pool={gmPool} isGm={isGm} onRollGm={onRollGm} />
        ) : (
          <>
            <div className="mono text-xs text-paper-fade mb-1">
              The Reich’s dice — <span className="text-blood">{gmHits} success{gmHits === 1 ? "" : "es"}</span>
            </div>
            <div className="tray">
              {gm.map((face, i) => (
                <Die key={i} kind="gm" value={face} state={gmState(face)} tilt={tiltFor(i + 3)} size="2.75rem" />
              ))}
              {gm.length === 0 && (
                <span className="mono text-paper-fade italic">Uncontested — the Reich never saw it coming.</span>
              )}
            </div>
          </>
        )}
      </div>

      {canDrive && gm !== undefined && (
        <button
          className="detonator mt-6"
          onClick={() => {
            play("discard");
            onResolve();
          }}
        >
          Discard &amp; resolve
        </button>
      )}
    </div>
  );
}

/**
 * The Reich is poised but hasn't thrown yet (RULES §4 BUILD_GM_POOL → ROLL). The pool size
 * is already known, so the table sees how many bone dice are coming; the GM holds the trigger.
 */
function ReichPending({ pool, isGm, onRollGm }: { pool: number; isGm: boolean; onRollGm: () => void }) {
  return (
    <div>
      <div className="mono text-xs text-paper-fade mb-1">
        The Reich answers — <span className="text-blood">{pool} {pool === 1 ? "die" : "dice"}</span>
      </div>
      <div className="tray">
        {Array.from({ length: Math.min(pool, 16) }, (_, i) => (
          <span key={i} className="reich-waiting-die" aria-hidden />
        ))}
      </div>
      <div className="mt-4">
        {isGm ? (
          <button className="detonator" onClick={onRollGm} title="Throw the Reich’s dice">
            Roll the Reich
          </button>
        ) : (
          <p className="mono text-sm text-paper-fade">The GM is rolling the Reich’s dice…</p>
        )}
      </div>
    </div>
  );
}
