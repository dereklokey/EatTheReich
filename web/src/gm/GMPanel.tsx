import { useState, type ReactNode } from "react";
import type { GameState } from "@shared/state/types.js";
import type { Intent } from "@shared/protocol/messages.js";
import type { Objective, Threat } from "@shared/domain/types.js";
import { CHAR_IDS, type SeatId, type GameEvent } from "@shared/events/types.js";
import { LOCATIONS_BY_SECTOR, type Sector } from "@shared/data/locations.js";
import { seatName } from "@/game/seats";
import { THREAT_CATALOG, loadLocation, newObjective, rescueObjective } from "./catalog";

/**
 * GM panel (CLAUDE.md §4) — the only GM-only surface. Frame scenes / quick-load a
 * location, add & tune Objectives and Threats (every value is an editable default,
 * §0), run end-of-round reinforcements, raise Downed rescues, and release seats.
 * Rendered as a slide-over so it never blocks the shared board.
 */
const SECTORS: Sector[] = [3, 2, 1];

export function GMPanel({
  state,
  send,
  events,
  onRewind,
  onClose,
}: {
  state: GameState;
  send: (i: Intent) => void;
  events: GameEvent[];
  onRewind: (toSeq: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[65] flex justify-end">
      <button className="flex-1 bg-night-deep/70" aria-label="close" onClick={onClose} />
      <div className="w-full max-w-md h-full overflow-y-auto bg-night-top/98 border-l border-paper-shadow/30 p-4 pb-24">
        <div className="flex items-center justify-between">
          <h2 className="display text-2xl text-paper">GM panel</h2>
          <button className="mono text-sm underline text-paper-fade" onClick={onClose}>close</button>
        </div>

        <SessionSection state={state} send={send} />
        <LocationSection send={send} hasBoard={state.board.objectives.length + state.board.threats.length > 0} />
        <ObjectivesSection state={state} send={send} />
        <ThreatsSection state={state} send={send} />
        <RescueSection state={state} send={send} />
        <RewindSection state={state} events={events} onRewind={onRewind} />
        <SeatsSection state={state} send={send} />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="display text-paper text-lg mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Stepper({ value, onChange, min = 0, max = 20 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <button className="mono px-1.5 bg-paper-shadow/50" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span className="mono w-6 text-center">{value}</span>
      <button className="mono px-1.5 bg-paper-shadow/50" onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </span>
  );
}

function SessionSection({ state, send }: { state: GameState; send: (i: Intent) => void }) {
  return (
    <Section title="Session & round">
      <div className="paper paper-tight flex flex-wrap items-center gap-2 mono text-sm">
        <span>Round {state.round}</span>
        <span className="text-paper-fade">· session {state.session.number}{state.session.active ? "" : " (idle)"}</span>
        <div className="ml-auto flex gap-2">
          {state.session.active ? (
            <button className="mono text-xs underline" onClick={() => send({ kind: "end_session" })}>end session</button>
          ) : (
            <button className="display bg-blood text-paper px-2 py-0.5 text-xs" style={{ borderRadius: 2 }} onClick={() => send({ kind: "start_session" })}>start session</button>
          )}
        </div>
      </div>
      <button
        className="mt-2 w-full display bg-blood text-paper py-2"
        style={{ borderRadius: 2 }}
        onClick={() => send({ kind: "end_round" })}
        title="Roll reinforcements (escalate Attack, restore zeroed threats) and advance the round"
      >
        End round → reinforcements
      </button>
    </Section>
  );
}

function LocationSection({ send, hasBoard }: { send: (i: Intent) => void; hasBoard: boolean }) {
  const [sel, setSel] = useState("");
  const load = () => {
    for (const list of Object.values(LOCATIONS_BY_SECTOR)) {
      const loc = list.find((l) => l.id === sel);
      if (loc) {
        const board = loadLocation(loc);
        send({ kind: "frame_scene", objectives: board.objectives, threats: board.threats, secondaryObjectives: board.secondaryObjectives });
        return;
      }
    }
  };
  return (
    <Section title="Frame a scene">
      <select className="mono w-full px-2 py-1.5 bg-paper text-paper-ink" value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">— pick a location —</option>
        {SECTORS.map((s) => (
          <optgroup key={s} label={`Sector ${s}`}>
            {LOCATIONS_BY_SECTOR[s].map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        className="mt-2 w-full display bg-dusk-mauve text-paper py-1.5 disabled:opacity-50"
        style={{ borderRadius: 2 }}
        disabled={!sel}
        onClick={load}
      >
        Load board{hasBoard ? " (replaces current)" : ""}
      </button>
    </Section>
  );
}

function ObjectivesSection({ state, send }: { state: GameState; send: (i: Intent) => void }) {
  const [name, setName] = useState("");
  const [rating, setRating] = useState(6);
  const patch = (id: string, p: Partial<Objective>) => send({ kind: "update_objective", id, patch: p });
  return (
    <Section title="Objectives">
      <div className="flex flex-col gap-1.5">
        {state.board.objectives.map((o) => (
          <div key={o.id} className="paper paper-tight flex items-center gap-2 mono text-sm">
            <span className="flex-1">{o.name}</span>
            <Stepper value={o.rating} onChange={(v) => patch(o.id, { rating: v })} />
            {o.rating > 0 && <button className="text-xs underline text-hazard" onClick={() => send({ kind: "complete_objective", id: o.id })}>done</button>}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        <input className="mono flex-1 px-2 py-1 bg-paper text-paper-ink" placeholder="new objective" value={name} onChange={(e) => setName(e.target.value)} />
        <Stepper value={rating} onChange={setRating} />
        <button
          className="display bg-blood text-paper px-2 text-sm" style={{ borderRadius: 2 }}
          disabled={!name.trim()}
          onClick={() => { send({ kind: "add_objective", objective: newObjective(name.trim(), rating) }); setName(""); }}
        >add</button>
      </div>
    </Section>
  );
}

function ThreatsSection({ state, send }: { state: GameState; send: (i: Intent) => void }) {
  const [pick, setPick] = useState(0);
  const patch = (id: string, p: Partial<Threat>) => send({ kind: "update_threat", id, patch: p });
  return (
    <Section title="Threats">
      <div className="flex flex-col gap-1.5">
        {state.board.threats.map((t) => (
          <div key={t.id} className="paper paper-tight mono text-sm">
            <div className="flex items-center gap-2">
              <span className="flex-1">{t.name}</span>
              <button className="text-xs underline text-blood" onClick={() => send({ kind: "remove_threat", id: t.id })}>remove</button>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs">
              <span className="flex items-center gap-1">rating <Stepper value={t.rating} onChange={(v) => patch(t.id, { rating: v })} /></span>
              <span className="flex items-center gap-1">ATK <Stepper value={t.attack} onChange={(v) => patch(t.id, { attack: v })} /></span>
              <span className="flex items-center gap-1">chal <Stepper value={t.challenge ?? 0} onChange={(v) => patch(t.id, { challenge: v })} /></span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        <select className="mono flex-1 px-2 py-1 bg-paper text-paper-ink" value={pick} onChange={(e) => setPick(Number(e.target.value))}>
          {THREAT_CATALOG.map((c, i) => <option key={i} value={i}>{c.label}</option>)}
        </select>
        <button
          className="display bg-blood text-paper px-2 text-sm" style={{ borderRadius: 2 }}
          onClick={() => send({ kind: "add_threat", threat: THREAT_CATALOG[pick]!.make() })}
        >add</button>
      </div>
    </Section>
  );
}

function RescueSection({ state, send }: { state: GameState; send: (i: Intent) => void }) {
  const downed = CHAR_IDS.filter((id) => state.characters[id]?.downed && !state.characters[id]?.dead);
  const existing = new Set(state.board.secondaryObjectives.filter((s) => s.rescueFor).map((s) => s.rescueFor));
  const need = downed.filter((id) => !existing.has(id));
  if (need.length === 0) return null;
  return (
    <Section title="Downed — rescue">
      {need.map((id) => (
        <button
          key={id}
          className="mt-1 w-full display bg-dusk-mauve text-paper py-1.5" style={{ borderRadius: 2 }}
          onClick={() => send({ kind: "add_secondary_objective", objective: rescueObjective(seatName(id), id) })}
        >
          Add rescue objective for {seatName(id)}
        </button>
      ))}
    </Section>
  );
}

function RewindSection({ state, events, onRewind }: { state: GameState; events: GameEvent[]; onRewind: (toSeq: number) => void }) {
  const recent = [...events].reverse().slice(0, 12);
  const label = (t: string) => t.toLowerCase().replace(/_/g, " ");
  return (
    <Section title="Rewind">
      <p className="mono text-[0.65rem] text-paper-fade mb-2">
        Undo is permanent — it drops events off the end of the log. Everyone’s screen jumps back.
      </p>
      <button
        className="w-full display bg-dusk-mauve text-paper py-1.5 disabled:opacity-40"
        style={{ borderRadius: 2 }}
        disabled={state.seq <= 1}
        onClick={() => onRewind(state.seq - 1)}
      >
        Undo last action (#{state.seq})
      </button>
      {recent.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {recent.map((e) => (
            <div key={e.seq} className="paper paper-tight flex items-center gap-2 mono text-[0.7rem]">
              <span className="text-paper-fade">#{e.seq}</span>
              <span className="flex-1">{label(e.type)} <span className="text-paper-fade">· {e.actor}</span></span>
              <button className="underline text-blood" title="rewind to just before this event" onClick={() => onRewind(e.seq - 1)}>
                ↩ before
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function SeatsSection({ state, send }: { state: GameState; send: (i: Intent) => void }) {
  const claimed = (["gm", ...CHAR_IDS] as SeatId[]).filter((s) => state.seats[s]?.claimed && s !== "gm");
  if (claimed.length === 0) return null;
  return (
    <Section title="Seats">
      <p className="mono text-[0.65rem] text-paper-fade mb-1">Release a seat so a returning player can re-claim it (lost-token recovery).</p>
      <div className="flex flex-wrap gap-1.5">
        {claimed.map((s) => (
          <button key={s} className="mono text-xs paper paper-tight" onClick={() => send({ kind: "release_seat", seat: s })}>
            release {seatName(s)}
          </button>
        ))}
      </div>
    </Section>
  );
}
