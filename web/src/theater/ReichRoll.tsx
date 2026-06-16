import { useCallback, useEffect, useState } from "react";
import type { DieFace } from "@shared/domain/types.js";
import { Die } from "@/components/dice/Die";
import { useGoDice } from "@/godice/GoDiceContext";
import { GoDiceConnect } from "@/godice/GoDiceConnect";
import { useSound } from "@/effects/SoundContext";
import "@/godice/godice.css";

/**
 * The GM's "Roll the Reich" controls (RULES §4 BUILD_GM_POOL → ROLL). The default is unchanged:
 * a detonator that has the server throw the pool (anti-fudge RNG). Issue #50 adds an opt-in
 * GoDice path — the GM throws their physical Bluetooth dice, the faces are read (or hand-typed),
 * and those are submitted as the Reich's roll (the "truth"); the same dice animation then plays
 * them out. GM-only; both render sites (the live-throw overlay and the static results panel)
 * already gate on `isGm`.
 *
 * `onRoll()` with no arg → server RNG; `onRoll(faces)` → use these exact faces. The capture tray
 * fills one slot per `pool` die as throws arrive, each slot tappable to correct a misread or to
 * hand-enter when there's no hardware; "Throw test dice" injects synthetic rolls so the whole
 * path works without owning GoDice.
 */
export function ReichRollControls({
  pool,
  onRoll,
}: {
  pool: number;
  onRoll: (results?: DieFace[]) => void;
}) {
  const goDice = useGoDice();
  const { play } = useSound();
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<(DieFace | null)[]>(() => Array(pool).fill(null));
  const [launched, setLaunched] = useState(false);

  // Keep the tray sized to the pool (it can change if the GM is slow and the board shifts).
  useEffect(() => {
    setSlots((cur) => {
      if (cur.length === pool) return cur;
      const next = cur.slice(0, pool);
      while (next.length < pool) next.push(null);
      return next;
    });
  }, [pool]);

  // While the GoDice panel is open, feed each incoming throw into the next empty slot. Extra
  // throws past a full tray are ignored — the GM clears or edits to fix a mis-capture.
  useEffect(() => {
    if (!open) return;
    return goDice.subscribeRolls((roll) => {
      play("clatter");
      setSlots((cur) => {
        const i = cur.indexOf(null);
        if (i === -1) return cur;
        const next = [...cur];
        next[i] = roll.value;
        return next;
      });
    });
  }, [open, goDice, play]);

  const filled = slots.filter((s) => s !== null).length;
  const ready = pool > 0 && filled === pool && !launched;

  const rollServer = useCallback(() => {
    if (launched) return;
    setLaunched(true);
    onRoll();
  }, [launched, onRoll]);

  const rollGoDice = useCallback(() => {
    if (!ready) return;
    setLaunched(true);
    onRoll(slots as DieFace[]);
  }, [ready, slots, onRoll]);

  // Tap a slot to cycle its face 1→6→1 — corrects a misread die or hand-enters with no hardware.
  const cycleSlot = (i: number) =>
    setSlots((cur) => {
      const next = [...cur];
      const v = next[i];
      next[i] = (v == null ? 1 : v === 6 ? 1 : ((v + 1) as DieFace)) as DieFace;
      return next;
    });
  const clearSlots = () => setSlots(Array(pool).fill(null));
  // Fill every empty slot with a synthetic throw — the hardware-free test path (issue #50).
  const throwTestDice = () => {
    const empties = slots.filter((s) => s === null).length;
    for (let i = 0; i < empties; i++) goDice.simulateRoll();
  };

  return (
    <div className="reichroll">
      <button className="detonator" disabled={launched} onClick={rollServer} title="The server throws the Reich's dice">
        {launched ? "casting…" : `Roll the Reich · ${pool}`}
      </button>

      {!open ? (
        <button className="reichroll__toggle" onClick={() => setOpen(true)}>
          ⚄ roll with GoDice
        </button>
      ) : (
        <div className="reichroll__godice">
          <div className="reichroll__head">
            <span className="reichroll__title">GoDice</span>
            <button className="reichroll__close" onClick={() => setOpen(false)} title="Back to the standard roll">
              ✕
            </button>
          </div>

          <GoDiceConnect />

          <div className="reichroll__tray" role="group" aria-label="captured Reich dice">
            {slots.map((face, i) => (
              <button
                key={i}
                className={`reichroll__slot ${face == null ? "reichroll__slot--empty" : ""}`}
                onClick={() => cycleSlot(i)}
                title={face == null ? "tap to set by hand" : "tap to correct"}
              >
                {face == null ? <span className="reichroll__slot-dot" /> : <Die kind="gm" value={face} size="2rem" />}
              </button>
            ))}
          </div>

          <div className="reichroll__cap-note">
            {filled}/{pool} read — throw your dice, or tap a slot to set it
          </div>

          <div className="reichroll__actions">
            <button className="detonator reichroll__commit" disabled={!ready} onClick={rollGoDice}>
              {launched ? "casting…" : ready ? "Roll the Reich with these" : `read ${pool - filled} more`}
            </button>
            <div className="reichroll__minor">
              <button className="reichroll__link" onClick={throwTestDice} title="Fill the empty slots with random faces — no hardware needed">
                throw test dice
              </button>
              {filled > 0 && (
                <button className="reichroll__link" onClick={clearSlots}>
                  clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
