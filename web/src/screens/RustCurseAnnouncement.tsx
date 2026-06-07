import { useEffect, useRef, useState } from "react";
import type { CharId, GameEvent } from "@shared/events/types.js";
import type { DieFace } from "@shared/domain/types.js";
import { seatName } from "@/game/seats";
import { Die } from "@/components/dice/Die";
import { useEffects } from "@/effects/EffectsContext";
import { useSound } from "@/effects/SoundContext";
import "./rust-curse.css";

/**
 * Rust Curse announcement (rulebook p56, issue #13). When the Rust-Witch corrodes a PC's
 * gear (EQUIPMENT_DEGRADED), the WHOLE TABLE sees who lost what — otherwise the degrade is
 * only a quiet drop to all-spent on one sheet plus a line in the GM panel. Mounted at the
 * Game shell beside the after-action report, centered so the two never stack. Tap-to-dismiss,
 * auto-clears, and reduce-effects drops the animation (the JS timer + tap still work).
 */
type Shown = { seq: number; seat: CharId; itemName: string; roll: DieFace };

export function RustCurseAnnouncement({ events }: { events: GameEvent[] }) {
  const { reduced } = useEffects();
  const { play } = useSound();
  const lastSeq = useRef(0);
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    let latest: GameEvent | undefined;
    for (const e of events) if (e.type === "EQUIPMENT_DEGRADED" && e.seq > lastSeq.current) latest = e;
    if (!latest || latest.type !== "EQUIPMENT_DEGRADED") return;
    lastSeq.current = latest.seq;
    setShown({ seq: latest.seq, seat: latest.payload.seat, itemName: latest.payload.itemName, roll: latest.payload.roll });
    play("discard"); // a gritty crumble — gear corroding away
    const t = setTimeout(() => setShown(null), 7000);
    return () => clearTimeout(t);
  }, [events, play]);

  if (!shown) return null;

  return (
    <div className="rust-curse" onClick={() => setShown(null)}>
      <div key={shown.seq} className={`rust-curse__card ${reduced ? "" : "rust-curse__card--anim"}`} role="status">
        <div className="rust-curse__head">
          <span className="rust-curse__title gothic">Rust Curse</span>
          <Die kind="gm" value={shown.roll} state="success" size="1.5rem" title={`rust roll: ${shown.roll}`} />
        </div>
        <div className={`rust-curse__body ${reduced ? "" : "rust-curse__body--anim"}`}>
          <span className="rust-curse__owner mono">{seatName(shown.seat)}’s</span>
          <span className="rust-curse__item gothic">{shown.itemName}</span>
          <span className="rust-curse__verdict mono">crumbles to rust — useless.</span>
        </div>
        <div className="rust-curse__dismiss mono">tap to dismiss</div>
      </div>
    </div>
  );
}
