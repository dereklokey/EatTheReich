import type { ReactNode } from "react";
import type { GameState, CharacterRuntime } from "@shared/state/types.js";
import type { SeatId } from "@shared/events/types.js";
import { CHAR_IDS } from "@shared/events/types.js";
import { seatName } from "@/game/seats";

/**
 * The shared board (CLAUDE.md §4): objectives, threats, and the vampire roster —
 * visible to everyone, read-only here (the resolution theater + GM panel that drive
 * it are the next increment). This is the calm dossier layer; no ambient motion.
 */
export function Board({ state, online }: { state: GameState; online: SeatId[] }) {
  return (
    <div className="substrate grain min-h-full p-4 pb-20 mx-auto max-w-5xl">
      <BoardHeader state={state} />

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
}: {
  id: string;
  char: CharacterRuntime;
  claimed: boolean;
  online: boolean;
  active: boolean;
}) {
  return (
    <div
      className={`paper ${char.dead ? "opacity-40" : char.downed ? "opacity-70 -rotate-1" : ""}`}
      style={active ? { boxShadow: "0 0 0 2px var(--hazard), 0 10px 22px rgba(0,0,0,0.5)" } : undefined}
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
