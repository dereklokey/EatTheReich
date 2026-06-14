import { useCallback, useEffect, useRef, useState } from "react";
import type { DieFace } from "@shared/domain/types.js";
import type { GameState, TurnState } from "@shared/state/types.js";
import type { Intent } from "@shared/protocol/messages.js";
import { rendingClawsInPlay, threatInPlay } from "@shared/domain/types.js";
import { CHARACTERS_BY_ID } from "@shared/data/characters.js";
import { seatName } from "@/game/seats";
import { Die, type DieVisualState } from "@/components/dice/Die";
import { TheaterShell } from "./Theater";
import { DiceArena } from "./DiceArena";
import { useEffects } from "@/effects/EffectsContext";
import { useSound } from "@/effects/SoundContext";
import type { Cue } from "@/effects/sound";
import "./injury-check.css";

/**
 * INJURY_CHECK (RULES §4/§5, DESIGN.md §6) — the beat between "Lock in" and the turn
 * closing. A GM Attack die got through, so the window opens, but the category die is the
 * wounded vampire's OWN throw: the active player (or GM) presses "Roll the wound", the
 * server rolls it (server-authoritative), and the purple die is hurled across the board
 * the same way the action dice were (the craps-table spectacle). It lands, the table reads
 * it, and the verdict stamps in — with a window to react before it bites: Chuck can mark
 * his cowboy hat to shrug the wound off entirely, Iryna can light a cigarette for +2 Blood.
 * Then "Take the hit" marks the box (or opens the Last Stand on a death) and the turn ends.
 */
type Stage = "await" | "throwing" | "settling" | "reveal";

// The verdict sound, by outcome. The wound bites as the stamp lands.
const VERDICT_CUE: Record<string, Cue> = { injury: "hit", downed: "downed", death: "crit" };

// Injury throws already played on THIS client — a peek/resume or a mid-window reconnect
// drops straight to the verdict instead of re-throwing the die.
const shownInjuryThrows = new Set<string>();

// Match the arena's player-die colouring so the die that flew in keeps its lit face when
// it settles into the verdict panel (no flicker across the cut).
function injuryVisual(face: DieFace): DieVisualState {
  if (face === 6) return "critical";
  if (face >= 4) return "success";
  return "normal";
}

export function InjuryCheck({
  turn,
  state,
  canDrive,
  canCancel,
  send,
  onMinimize,
  onCancel,
}: {
  turn: TurnState;
  state: GameState;
  /** The wounded player — drives the wound throw, reactions, and "take the hit". */
  canDrive: boolean;
  /** The active player or the GM may abort the turn (issues #42/#43). */
  canCancel: boolean;
  send: (i: Intent) => void;
  onMinimize: () => void;
  onCancel: () => void;
}) {
  const { reduced } = useEffects();
  const { play } = useSound();
  const pending = turn.pendingInjury;
  const seat = turn.seat;
  const sheet = CHARACTERS_BY_ID[seat];
  const char = state.characters[seat];

  const face = pending?.face;
  const outcome = pending?.outcome;
  const throwKey = face !== undefined ? `${seat}:${face}` : "";
  const alreadyShown = useRef(throwKey !== "" && shownInjuryThrows.has(throwKey));

  // Start awaiting the throw; if the die's already rolled when this mounts (reduce-effects,
  // or a peek/reconnect that's seen it), drop straight to the verdict.
  const [stage, setStage] = useState<Stage>(() =>
    pending === undefined ? "await" : reduced || alreadyShown.current ? "reveal" : "throwing",
  );
  const [arenaFading, setArenaFading] = useState(false);
  const [rolling, setRolling] = useState(false);
  // Corrosive Fluids (#34): which Threat Chuck eats 2 rating off when this wound is marked.
  // Undefined falls back to the first in-play Threat at send time (the usual single-Threat case).
  const [corrosiveTargetId, setCorrosiveTargetId] = useState<string | undefined>(undefined);

  // The throw arrived (the driver pressed "Roll the wound") → fling it, or reveal at once
  // on a reduce-effects client.
  useEffect(() => {
    if (stage !== "await" || pending === undefined) return;
    setStage(reduced ? "reveal" : "throwing");
  }, [stage, pending, reduced]);

  // Throw sounds as the die takes flight (mirrors the action roll).
  useEffect(() => {
    if (stage !== "throwing") return;
    play("concussion");
    play("clatter");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // The die has come to rest: hold a beat so the table reads it, then fade the arena out and
  // raise the dark verdict panel.
  useEffect(() => {
    if (stage !== "settling") return;
    const t1 = setTimeout(() => setArenaFading(true), 800);
    const t2 = setTimeout(() => setStage("reveal"), 1400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [stage]);

  // Remember this throw so a later re-mount (peek/resume) skips the spectacle.
  useEffect(() => {
    if (throwKey) shownInjuryThrows.add(throwKey);
  }, [throwKey]);

  // The wound bites once, as the verdict reaches the panel.
  const cued = useRef(false);
  useEffect(() => {
    if (stage !== "reveal" || cued.current || !outcome) return;
    cued.current = true;
    if (reduced) play("concussion");
    play(VERDICT_CUE[outcome.kind] ?? "hit");
  }, [stage, outcome, reduced, play]);

  const onArenaSettled = useCallback(() => setStage("settling"), []);
  // The throw sound rides the die's flight (the "throwing" effect / the reduced reveal), so
  // the press itself just fires the intent — the server's roll is what sets it loose.
  const throwInjury = () => {
    setRolling(true);
    send({ kind: "roll_injury" });
  };

  const leftover = turn.gmDiceRemaining ?? 0;
  const intro = (
    <p className="mono text-xs text-paper-fade mt-1">
      <span className="text-blood">
        {leftover} Attack{leftover === 1 ? "" : "s"}
      </span>{" "}
      got through {seatName(seat)}’s guard.
    </p>
  );

  // THE THROW — the purple die flies across the live board, then settles. No dark panel here
  // (like the action roll), so it bounces over the dossier, not inside the theater.
  if ((stage === "throwing" || stage === "settling") && face !== undefined) {
    return (
      <>
        <DiceArena
          throws={[{ id: "injury", kind: "player", dice: [face] }]}
          fading={arenaFading}
          onThrowSettled={onArenaSettled}
        />
        <div className="roll-stage__head">
          {seatName(seat)}’s wound
          <small>the bones decide how deep it cuts</small>
        </div>
      </>
    );
  }

  // AWAITING THE THROW — the blow is coming; the driver casts the category die.
  if (stage === "await" || !pending || !outcome || outcome.kind === "none") {
    return (
      <TheaterShell turn={turn} canDrive={canDrive} canCancel={canCancel} onMinimize={onMinimize} onCancel={onCancel}>
        <div className="injury-check">
          <div className="theater__phase text-sm">Injury check</div>
          {intro}
          <div className="injury-check__stage injury-check__stage--await mt-4">
            <p className="mono text-sm text-paper-fade">The Reich’s blow has found its mark.</p>
          </div>
          {canDrive ? (
            <div className="injury-actions mt-6">
              <button className="detonator" onClick={throwInjury} disabled={rolling} title="Throw the category die">
                {rolling ? "Casting…" : "Roll the wound"}
              </button>
            </div>
          ) : (
            <p className="mono text-xs text-paper-fade mt-6 text-center">{seatName(seat)} steadies for the blow…</p>
          )}
        </div>
      </TheaterShell>
    );
  }

  // THE VERDICT — the die has landed; name the wound, offer the reactive escapes, take the hit.
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

  // Corrosive Fluids (#34): if Chuck has the passive available and the wound is a normal Injury,
  // marking it corrodes 2 rating off a Threat he names. Offered as a target picker among the Threats
  // in play; the server recomputes the cut (anti-fudge). A locked advance / non-injury outcome → none.
  const corrosivePower =
    outcome.kind === "injury"
      ? (sheet?.advances ?? []).find((p) => p.reduceThreatRatingOnInjury && char.unlockedAdvances.includes(p.id)) ??
        (sheet?.abilities ?? []).find((p) => p.reduceThreatRatingOnInjury)
      : undefined;
  const corrosiveThreats = corrosivePower ? state.board.threats.filter(threatInPlay) : [];
  // The Threat that'll actually be corroded: the explicit pick, else the first in play.
  const corrosiveTarget = corrosiveThreats.find((t) => t.id === corrosiveTargetId) ?? corrosiveThreats[0];
  const corrosivePayload = corrosiveTarget ? { corrosiveTargetId: corrosiveTarget.id } : {};

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
    send({ kind: "resolve_injury", ...corrosivePayload });
  };
  // Werhund 'Rending Claws' (rulebook p64, #24): a normal Injury attributed to a Werhund in
  // play marks the WHOLE category, not one box. The table pins the aggregate Reich hit on the
  // beast; the deeper-wound cue lands, then the box fills.
  const werhundInPlay = rendingClawsInPlay(state.board.threats);
  const rendHit = () => {
    play("downed");
    send({ kind: "resolve_injury", rending: true, ...corrosivePayload });
  };

  return (
    <TheaterShell turn={turn} canDrive={canDrive} canCancel={canCancel} onMinimize={onMinimize} onCancel={onCancel}>
      <div className={`injury-check injury-check--${verdict.tone}`}>
        <div className="theater__phase text-sm">Injury check</div>
        {intro}

        {/* The category die rests where it fell; the verdict stamps in. */}
        <div className="injury-check__stage mt-4">
          <div className="injury-check__die">
            <Die kind="player" value={pending.face} state={injuryVisual(pending.face)} size="3.4rem" title={`injury die showing ${pending.face}`} />
          </div>
          <div className="injury-check__verdict" key={pending.face}>
            <div className="injury-check__headline">{verdict.headline}</div>
            <div className="injury-check__sub mono text-xs">{verdict.sub}</div>
          </div>
        </div>

        {canDrive && corrosivePower && corrosiveThreats.length > 0 && (
          <div className="injury-corrosive mt-4">
            <p className="mono text-xs text-paper-fade">
              <span className="text-blood">Corrosive Fluids</span> — the wound sprays acid, eating 2 rating off:
            </p>
            <div className="injury-corrosive__targets mt-2">
              {corrosiveThreats.map((t) => (
                <button
                  key={t.id}
                  className={`injury-corrosive__chip${corrosiveTarget?.id === t.id ? " injury-corrosive__chip--on" : ""}`}
                  onClick={() => setCorrosiveTargetId(t.id)}
                  title={`Corrode ${t.name} — rating ${t.rating} → ${Math.max(0, t.rating - (corrosivePower.reduceThreatRatingOnInjury ?? 0))}`}
                >
                  {t.name} <span className="mono text-xs">({t.rating}→{Math.max(0, t.rating - (corrosivePower.reduceThreatRatingOnInjury ?? 0))})</span>
                </button>
              ))}
            </div>
          </div>
        )}

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
            {outcome.kind === "injury" && werhundInPlay && (
              <button
                className="injury-react injury-react--rend"
                onClick={rendHit}
                title="Attribute this wound to the Werhund — Rending Claws marks the whole category"
              >
                Rending Claws — <span className="text-blood">rend the whole wound</span>
              </button>
            )}
            <button className="detonator" onClick={takeHit} title="Mark the wound and end the turn">
              {outcome.kind === "death" ? "Face your death" : outcome.kind === "downed" ? "Go down" : "Take the hit"}
            </button>
          </div>
        ) : (
          <p className="mono text-xs text-paper-fade mt-6 text-center">{seatName(seat)} is taking the hit…</p>
        )}
      </div>
    </TheaterShell>
  );
}
