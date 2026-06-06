import type { ReactNode } from "react";
import type { GameState, CharacterRuntime } from "@shared/state/types.js";
import type { SeatId, CharId } from "@shared/events/types.js";
import { CHAR_IDS } from "@shared/events/types.js";
import { seatName } from "@/game/seats";

/**
 * The shared board (CLAUDE.md §4): objectives, threats, and the vampire roster —
 * visible to everyone, read-only here (the resolution theater + GM panel that drive
 * it are the next increment). This is the calm dossier layer; no ambient motion.
 */
export function Board({
  state,
  online,
  onOpenSheet,
  onFrameScene,
}: {
  state: GameState;
  online: SeatId[];
  onOpenSheet?: (id: CharId) => void;
  /** GM-only: open the GM panel to frame the first scene (shown as an empty-state CTA). */
  onFrameScene?: () => void;
}) {
  const empty = state.board.objectives.length === 0 && state.board.threats.length === 0;
  return (
    <div className="substrate grain min-h-full p-4 pb-20 mx-auto max-w-5xl">
      <BoardHeader state={state} />

      {empty && onFrameScene && (
        <div className="paper mt-4 text-center">
          <p className="display text-xl">No scene yet</p>
          <p className="mono text-xs text-paper-fade mt-1">Load a location or add objectives and threats to set the board.</p>
          <button
            className="display text-paper bg-blood px-4 py-2 mt-3"
            style={{ borderRadius: 2 }}
            onClick={onFrameScene}
          >
            Frame a scene
          </button>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section>
          <h2 className="display text-paper text-xl mb-2">Objectives</h2>
          {state.board.objectives.length === 0 && <Empty>No scene framed yet.</Empty>}
          <div className="grid gap-2">
            {state.board.objectives.map((o) => (
              <div key={o.id} className="paper paper-tight">
                <div className="flex items-baseline justify-between">
                  <span className="mono font-bold">{o.name}</span>
                  <RatingPips n={o.rating} tone="hazard" />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="display text-paper text-xl mb-2">Threats</h2>
          {state.board.threats.length === 0 && <Empty>The street is quiet. For now.</Empty>}
          <div className="grid gap-2">
            {state.board.threats.map((t) => (
              <div key={t.id} className={`paper paper-tight ${t.rating <= 0 ? "opacity-50" : ""}`}>
                <div className="flex items-baseline justify-between">
                  <span className="mono font-bold">{t.name}</span>
                  <span className="mono text-xs text-blood">ATK {t.attack}</span>
                </div>
                <RatingPips n={t.rating} tone="blood" />
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="mt-6">
        <h2 className="display text-paper text-xl mb-2">The crew</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CHAR_IDS.map((id) => (
            <CharCard
              key={id}
              id={id}
              char={state.characters[id]}
              claimed={state.seats[id]?.claimed ?? false}
              online={online.includes(id)}
              active={state.activeSeat === id}
              // Whose turn (§6): the active vampire takes a warm spotlight; the rest
              // recede while someone holds the floor. A state change, not ambient motion.
              recede={!!state.activeSeat && state.activeSeat !== id && (state.seats[id]?.claimed ?? false)}
              onOpen={onOpenSheet ? () => onOpenSheet(id) : undefined}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function BoardHeader({ state }: { state: GameState }) {
  return (
    <div className="paper paper-tight flex flex-wrap items-center gap-x-6 gap-y-1">
      <span className="mono text-sm">
        <span className="text-paper-fade">Round</span> <b>{state.round}</b>
      </span>
      <span className="mono text-sm">
        <span className="text-paper-fade">Session</span> <b>{state.session.number}</b>{" "}
        {state.session.active ? "" : <span className="text-paper-fade">(not started)</span>}
      </span>
      <span className="mono text-sm ml-auto">
        {state.activeSeat ? (
          <span className="hl">Now: {seatName(state.activeSeat)}</span>
        ) : (
          <span className="text-paper-fade">Awaiting the next turn</span>
        )}
      </span>
    </div>
  );
}

function CharCard({
  id,
  char,
  claimed,
  online,
  active,
  recede,
  onOpen,
}: {
  id: string;
  char: CharacterRuntime;
  claimed: boolean;
  online: boolean;
  active: boolean;
  recede: boolean;
  onOpen?: () => void;
}) {
  const spotlight = active
    ? {
        transform: "translateY(-3px) scale(1.02)",
        boxShadow: "0 0 0 2px var(--hazard-warm), 0 0 28px rgba(232,148,28,0.35), 0 14px 28px rgba(0,0,0,0.55)",
      }
    : recede
      ? { opacity: 0.62 }
      : undefined;
  return (
    <div
      className={`paper ${onOpen ? "cursor-pointer" : ""} ${char.dead ? "opacity-40" : char.downed ? "opacity-70 -rotate-1" : ""}`}
      style={{ transition: "transform 220ms var(--ease-impact), box-shadow 220ms, opacity 220ms", ...spotlight }}
      onClick={onOpen}
      title={onOpen ? "open sheet" : undefined}
    >
      <div className="flex items-center justify-between">
        <span className="display text-lg">{seatName(id as SeatId)}</span>
        <span className={`dot ${online ? "dot-online" : "dot-away"}`} />
      </div>
      <div className="mono text-[0.65rem] text-paper-fade">
        {char.dead ? "DEAD" : char.downed ? "DOWNED" : claimed ? "in play" : "unclaimed"}
      </div>

      <div className="mt-2">
        <div className="mono text-[0.65rem] text-paper-fade mb-0.5">Blood {char.blood}/10</div>
        <BloodMeter blood={char.blood} />
      </div>

      <div className="mt-2">
        <div className="mono text-[0.65rem] text-paper-fade mb-0.5">Injuries</div>
        <InjuryTrack injuries={char.injuries} />
      </div>
    </div>
  );
}

function BloodMeter({ blood }: { blood: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className="h-2.5 flex-1"
          style={{ background: i < blood ? "var(--blood)" : "var(--paper-shadow)", borderRadius: 1 }}
        />
      ))}
    </div>
  );
}

function InjuryTrack({ injuries }: { injuries: readonly number[] }) {
  return (
    <div className="flex gap-2">
      {injuries.map((marked, cat) => (
        <div key={cat} className="flex gap-0.5">
          {[1, 2].map((box) => (
            <span
              key={box}
              className="grid place-items-center w-4 h-4 border"
              style={{ borderColor: "var(--paper-shadow)", color: "var(--blood)" }}
            >
              {marked >= box ? "✕" : ""}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function RatingPips({ n, tone }: { n: number; tone: "hazard" | "blood" }) {
  const color = tone === "hazard" ? "var(--hazard)" : "var(--blood)";
  return (
    <span className="inline-flex items-center gap-1">
      <span className="mono text-xs text-paper-fade">{n}</span>
      <span className="inline-flex gap-0.5">
        {Array.from({ length: Math.max(0, Math.min(n, 12)) }, (_, i) => (
          <span key={i} className="w-1.5 h-3" style={{ background: color, borderRadius: 1 }} />
        ))}
      </span>
    </span>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="mono text-sm text-paper-fade italic">{children}</p>;
}
