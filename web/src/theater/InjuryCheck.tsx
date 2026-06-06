import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { GameState, TurnState } from "@shared/state/types.js";
import type { Intent } from "@shared/protocol/messages.js";
import { CHARACTERS_BY_ID } from "@shared/data/characters.js";
import { seatName } from "@/game/seats";
import { Die } from "@/components/dice/Die";
import { useEffects } from "@/effects/EffectsContext";
import { useSound } from "@/effects/SoundContext";
import type { Cue } from "@/effects/sound";
import "./injury-check.css";

/**
 * INJURY_CHECK (RULES §4/§5, DESIGN.md §6) — the beat between "Lock in" and the turn
 * closing. The server has already rolled the category d6 and PARKED the result; here the
 * whole table watches it land and the verdict stamp in, and the active player (or GM) gets
 * a window to react before it bites: Chuck can mark his cowboy hat to shrug the wound off
 * entirely, Iryna can light a cigarette for +2 Blood. Then "Take the hit" marks the box
 * (or opens the Last Stand on a death) and the turn ends.
 */
export function InjuryCheck({
  turn,
  state,
  canDrive,
  send,
}: {
  turn: TurnState;
  state: GameState;
  canDrive: boolean;
  send: (i: Intent) => void;
}) {
  const { reduced } = useEffects();
  const { play } = useSound();
  const pending = turn.pendingInjury;
  const seat = turn.seat;
  const sheet = CHARACTERS_BY_ID[seat];
  const char = state.characters[seat];

  const [revealed, setRevealed] = useState(reduced);
  const seen = useRef(false);

  const outcome = pending?.outcome;
  const VERDICT_CUE: Record<string, Cue> = { injury: "hit", downed: "downed", death: "crit" };

  useEffect(() => {
    if (seen.current || !outcome) return;
    seen.current = true;
    // The wound lands (sound has its own mute, independent of reduce-effects).
    play("concussion");
    const t = setTimeout(
      () => {
        setRevealed(true);
        play(VERDICT_CUE[outcome.kind] ?? "hit");
      },
      reduced ? 0 : 620,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `none` never parks (commit only opens the window when a die got through), but the
  // shared InjuryOutcome union carries it — narrow it away so the verdict below is typed.
  if (!pending || !outcome || outcome.kind === "none") return null;

  const leftover = turn.gmDiceRemaining ?? 0;

  // What the wound is called, in this character's own words (sheets pp. 14–24).
  const cat = sheet?.injuries[outcome.kind === "death" ? 0 : outcome.category];
  const verdict =
    outcome.kind === "death"
      ? { headline: "DEATH", sub: "All six wounds are marked.", tone: "death" as const }
      : outcome.kind === "downed"
        ? { headline: "DOWNED", sub: `${cat?.boxes[1]?.label ?? "a grievous wound"} — someone has to drag ${seatName(seat)} clear.`, tone: "downed" as const }
        : {
            headline: cat?.boxes[outcome.box - 1]?.label ?? "A wound",
            sub: outcome.box === 2 && cat?.boxes[1]?.penalty ? `Penalty: ${cat.boxes[1].penalty}` : "A flesh wound — for a vampire.",
            tone: "injury" as const,
          };

  // Reactive gear of the character taking the hit, still holding a use (RULES §5).
  const reactive = (sheet?.equipment ?? []).filter((e) => e.reactive && (char.equipmentUses[e.id] ?? 0) > 0);
  const hat = outcome.kind !== "death" ? reactive.find((e) => e.reactive?.ignoreInjury) : undefined;
  const bloodItems = reactive.filter((e) => e.reactive?.blood);

  const shrugOff = () => {
    if (!hat) return;
    play("defend");
    send({ kind: "use_equipment", seat, itemId: hat.id });
    send({ kind: "resolve_injury", ignore: true });
  };
  const lightUp = (itemId: string) => {
    play("feed");
    send({ kind: "use_equipment", seat, itemId });
  };
  const takeHit = () => {
    play(outcome.kind === "death" ? "crit" : outcome.kind === "downed" ? "downed" : "hit");
    send({ kind: "resolve_injury" });
  };

  const dieEl = <Die kind="gm" value={pending.face} state={revealed ? "success" : "normal"} size="3.4rem" title={`injury die showing ${pending.face}`} />;

  return (
    <div className={`injury-check injury-check--${verdict.tone}`}>
      <div className="theater__phase text-sm">Injury check</div>
      <p className="mono text-xs text-paper-fade mt-1">
        <span className="text-blood">
          {leftover} Attack{leftover === 1 ? "" : "s"}
        </span>{" "}
        got through {seatName(seat)}’s guard.
      </p>

      {/* The category die lands, then the verdict stamps in. */}
      <div className="injury-check__stage mt-4">
        {reduced ? (
          <div className="injury-check__die">{dieEl}</div>
        ) : (
          <motion.div
            className="injury-check__die"
            initial={{ y: -120, rotate: -28, opacity: 0, scale: 1.1 }}
            animate={{ y: 0, rotate: 0, opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 460, damping: 22 }}
          >
            {dieEl}
          </motion.div>
        )}

        {revealed && (
          <div className="injury-check__verdict" key={pending.face}>
            <div className="injury-check__headline">{verdict.headline}</div>
            <div className="injury-check__sub mono text-xs">{verdict.sub}</div>
          </div>
        )}
      </div>

      {canDrive ? (
        <div className="injury-actions mt-6">
          {bloodItems.map((e) => (
            <button key={e.id} className="injury-react" onClick={() => lightUp(e.id)} title={e.note}>
              Light up — {e.name} · <span className="text-blood">+{e.reactive?.blood} Blood</span>
            </button>
          ))}
          {hat && (
            <button className="injury-react injury-react--shrug" onClick={shrugOff} title={hat.note}>
              Shrug it off — {hat.name}
            </button>
          )}
          <button className="detonator" onClick={takeHit} title="Mark the wound and end the turn">
            {outcome.kind === "death" ? "Face your death" : outcome.kind === "downed" ? "Go down" : "Take the hit"}
          </button>
        </div>
      ) : (
        <p className="mono text-xs text-paper-fade mt-6 text-center">
          {revealed ? `${seatName(seat)} is taking the hit…` : `The Reich’s blow lands on ${seatName(seat)}…`}
        </p>
      )}
    </div>
  );
}
