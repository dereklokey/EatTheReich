import { useState } from "react";
import type { Intent } from "@shared/protocol/messages.js";
import { FREEFORM_MAX_DICE } from "@shared/protocol/messages.js";
import type { SeatId } from "@shared/events/types.js";
import type { FreeformRoll } from "@shared/state/types.js";
import type { DieFace } from "@shared/domain/types.js";
import { Die, type DieKind, type DieVisualState } from "@/components/dice/Die";
import "./freeform.css";

/**
 * Freeform out-of-turn dice (issue #17). A compact bar — above the blood meter on the character
 * sheet, and at the top of the GM panel — for the table that drives the Havoc math by voice and just
 * wants to *throw some dice everyone watches*. Click the die to build a handful, hit Roll, and the
 * server throws them in the shared arena (FreeformArena animates it); the settled faces land here as
 * the "last throw" readout, visible to the whole table. The Roll control is the owner's (and the GM's)
 * alone and is disabled while a turn owns the arena — the result line shows for everyone.
 */
function visualFor(kind: DieKind, face: DieFace): DieVisualState {
  if (kind === "player") return face === 6 ? "critical" : face >= 4 ? "success" : "normal";
  return face >= 4 ? "success" : "normal";
}

export function FreeformRollBar({
  seat,
  kind,
  canEdit,
  busy,
  lastRoll,
  send,
  tone = "paper",
}: {
  seat: SeatId;
  /** Die colour to throw — vampire ("player") on a sheet, the Reich's ("gm") in the GM panel. */
  kind: DieKind;
  /** Owner or GM: show the builder + Roll control. Others see only the last-throw readout. */
  canEdit: boolean;
  /** A turn is occupying the shared arena → rolling is blocked (the server refuses too). */
  busy: boolean;
  /** This seat's last freeform result, for the readout (persists until the next throw). */
  lastRoll?: FreeformRoll;
  send: (i: Intent) => void;
  /** Container palette: light sheet ("paper") vs the dark GM panel ("night"). */
  tone?: "paper" | "night";
}) {
  const [count, setCount] = useState(0);
  // A read-only viewer with nothing thrown yet has nothing to show.
  if (!canEdit && !(lastRoll && lastRoll.faces.length > 0)) return null;

  const add = () => setCount((c) => Math.min(FREEFORM_MAX_DICE, c + 1));
  const sub = () => setCount((c) => Math.max(0, c - 1));
  const roll = () => {
    if (count < 1 || busy) return;
    send({ kind: "freeform_roll", seat, count });
    setCount(0);
  };

  return (
    <div className={`freeform freeform--${tone}`}>
      {canEdit && (
        <div className="freeform__build">
          <button
            type="button"
            className="freeform__add"
            onClick={add}
            disabled={busy || count >= FREEFORM_MAX_DICE}
            title={count >= FREEFORM_MAX_DICE ? `max ${FREEFORM_MAX_DICE} dice` : "add a die to the throw"}
            aria-label="add a die to the throw"
          >
            <Die kind={kind} value={6} state="normal" size="1.3rem" />
            <span className="freeform__plus" aria-hidden>+</span>
          </button>

          {count > 0 ? (
            <span className="freeform__pending" aria-hidden>
              {Array.from({ length: count }, (_, i) => (
                <Die key={i} kind={kind} value={6} state="normal" size="1.05rem" />
              ))}
            </span>
          ) : (
            <span className="freeform__prompt mono">tap to build a throw</span>
          )}

          <span className="freeform__spacer" />

          {count > 0 && (
            <button type="button" className="freeform__sub mono" onClick={sub} title="remove a die" aria-label="remove a die">
              −
            </button>
          )}
          <button
            type="button"
            className="freeform__roll"
            onClick={roll}
            disabled={count < 1 || busy}
            title={busy ? "finish the current turn first" : "throw the dice in the arena"}
          >
            Roll{count ? ` ${count}` : ""}
          </button>
        </div>
      )}

      {busy && canEdit && <p className="freeform__hint mono">a turn owns the arena — finish it first</p>}

      {lastRoll && lastRoll.faces.length > 0 && (
        <div className="freeform__result">
          <span className="freeform__result-label mono">last throw</span>
          <span className="freeform__dice">
            {lastRoll.faces.map((f, i) => (
              <Die key={i} kind={lastRoll.kind} value={f} state={visualFor(lastRoll.kind, f)} size="1.3rem" />
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
