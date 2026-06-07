import { useEffect, useRef, useState } from "react";
import type { GameEvent } from "@shared/events/types.js";
import type { GameState } from "@shared/state/types.js";
import { summarizeCommittedTurn, type TurnSummary } from "@shared/state/turnSummary.js";
import { useEffects } from "@/effects/EffectsContext";
import { useSound } from "@/effects/SoundContext";
import "./after-report.css";

/**
 * After-action report. When a turn closes (ALLOCATION_COMMITTED), this folds the turn's
 * whole event log into a dossier of everything that happened — progress, kills, defends,
 * feeding, SPECIALs, the GM whiff, AND the easy-to-miss server-side beats (Corpse Eater's
 * +1 Blood, Dead Man's Luck cancelling a Reich success). Mounted at the Game shell so it
 * survives the turn closing; the whole table sees it (watchers never saw the per-drop
 * spectacle). Tap to dismiss, or it clears on its own. Reduce-effects → no stagger.
 */
type Shown = { seq: number; summary: TurnSummary };

const KIND_LABEL: Record<string, string> = {
  kill: "KILL",
  complete: "DONE",
  eliminate: "HIT",
  advance: "OBJ",
  defend: "DEF",
  feed: "BLOOD",
  special: "SPECIAL",
  blood: "BLOOD",
  passive: "PASSIVE",
  whiff: "WHIFF",
  injury: "INJURY",
  downed: "DOWN",
  bonus: "BONUS",
};

export function TurnSummaryReport({ events, state }: { events: GameEvent[]; state: GameState | null }) {
  const { reduced } = useEffects();
  const { play } = useSound();
  const lastSeq = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    let latest: GameEvent | undefined;
    for (const e of events) if (e.type === "ALLOCATION_COMMITTED" && e.seq > lastSeq.current) latest = e;
    if (!latest || !stateRef.current) return;
    lastSeq.current = latest.seq;
    const summary = summarizeCommittedTurn(events, latest.seq, stateRef.current);
    if (!summary) return;
    setShown({ seq: latest.seq, summary });
    play("stamp");
    const dwell = Math.min(9000, 3600 + summary.lines.length * 750);
    const t = setTimeout(() => setShown(null), reduced ? Math.min(dwell, 5000) : dwell);
    return () => clearTimeout(t);
  }, [events, reduced, play]);

  if (!shown) return null;
  const { summary } = shown;

  return (
    <div className="after-report" onClick={() => setShown(null)}>
      <div key={shown.seq} className={`after-report__card ${reduced ? "" : "after-report__card--anim"}`} role="status">
        <div className="after-report__head">
          <span className="after-report__who gothic">{summary.charName}</span>
          <span className="after-report__tag mono">after-action</span>
        </div>
        <ul className="after-report__lines">
          {summary.lines.map((l, i) => (
            <li
              key={i}
              className={`after-report__line after-report__line--${l.kind} ${l.emphasis ? "after-report__line--loud" : ""} ${reduced ? "" : "after-report__line--anim"}`}
              style={{ "--i": i } as React.CSSProperties}
            >
              <span className="after-report__chip mono">{KIND_LABEL[l.kind] ?? "·"}</span>
              <span className="mono">{l.text}</span>
            </li>
          ))}
        </ul>
        <div className="after-report__dismiss mono">tap to dismiss</div>
      </div>
    </div>
  );
}
