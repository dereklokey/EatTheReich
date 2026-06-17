import { useEffect, useRef, useState } from "react";
import { useGoDice } from "./GoDiceContext.js";
import { GoDiceConnect } from "./GoDiceConnect.js";
import { GoDiceDiagnostic } from "./GoDiceDiagnostic.js";
import "./godice.css";

/** A standard GoDice set is six; show at least that many lamps, growing if more are paired. */
const TARGET_DICE = 6;

/**
 * A persistent GoDice status strip for the header (issue #50) — GM-only. A row of die lamps lit
 * for each connected die and dimmed for the rest, so the GM can see at a glance that their set is
 * live without opening anything. The whole strip flashes on any die traffic (the "wobble to
 * confirm" cue), and clicking it opens a popover with the full connect / reconnect controls — so
 * dice can be set up before the first turn, not only inside the Reich-roll panel.
 */
export function GoDiceIndicator({ className = "" }: { className?: string }) {
  const goDice = useGoDice();
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const connected = goDice.dice.filter((d) => d.connected).length;
  const slots = Math.max(TARGET_DICE, goDice.dice.length);

  // Flash the strip on any live frame from a die — a glanceable "they're talking" heartbeat.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const unsub = goDice.subscribeActivity(() => {
      setPulse(true);
      if (t) clearTimeout(t);
      t = setTimeout(() => setPulse(false), 600);
    });
    return () => {
      unsub();
      if (t) clearTimeout(t);
    };
  }, [goDice]);

  // Dismiss the popover on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = goDice.supported
    ? `GoDice — ${connected} connected`
    : "GoDice — Web Bluetooth unavailable (use Chrome/Edge)";

  return (
    <div className={`godice-ind ${className}`} ref={ref}>
      <button
        className={`godice-ind__strip ${pulse ? "godice-ind__strip--pulse" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={label}
        aria-label={label}
        aria-expanded={open}
      >
        {Array.from({ length: slots }, (_, i) => (
          <span key={i} className={`godice-ind__pip ${i < connected ? "is-on" : "is-off"}`} aria-hidden />
        ))}
      </button>
      {open && (
        <div className="godice-ind__pop" role="dialog" aria-label="GoDice">
          <div className="godice-ind__pop-head">
            <span className="reichroll__title">GoDice</span>
            <button className="reichroll__close" onClick={() => setOpen(false)} title="close">
              ✕
            </button>
          </div>
          <GoDiceConnect />
          <GoDiceDiagnostic />
          {connected > 0 && (
            <button className="reichroll__link godice-ind__disconnect" onClick={() => goDice.disconnectAll()}>
              disconnect all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
