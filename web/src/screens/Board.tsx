import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import type { GameState, CharacterRuntime } from "@shared/state/types.js";
import type { SeatId, CharId, GameEvent } from "@shared/events/types.js";
import { CHAR_IDS } from "@shared/events/types.js";
import { LOCATIONS_BY_ID } from "@shared/data/locations.js";
import { seatName } from "@/game/seats";
import { useEffects } from "@/effects/EffectsContext";
import { useSound } from "@/effects/SoundContext";
import "./blood-arc.css";
import "./board.css";

/** Deterministic 32-bit string hash — stable per id, so a card's look never flickers. */
function hash32(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;
  return h;
}

/**
 * Pick one of the torn-corner variants for a card from its id, so cards don't all share
 * the same cut. 0 → the base `.paper` polygon (no extra class); 1–3 → `.paper-cut-N`.
 */
function paperCut(seed: string): string {
  const v = Math.abs(hash32(seed)) % 4;
  return v === 0 ? "" : `paper-cut-${v}`;
}

/**
 * A tiny stable tilt (degrees) so cards sit like loosely-stacked papers rather than a rigid
 * grid. Id-hashed and decorrelated from the cut. Skipped on the wide cards (turn / round /
 * scene), where a rotation would read as misalignment rather than character.
 */
const TILTS = [-0.8, -0.5, -0.3, 0.3, 0.5, 0.8];
function cardTilt(seed: string): number {
  return TILTS[Math.abs(hash32(`${seed}·tilt`)) % TILTS.length]!;
}

/** A live blood-share spectacle: a crimson arc from giver to receiver (§6). */
interface ShareArc {
  from: { x: number; y: number };
  to: { x: number; y: number };
  fromId: CharId;
  toId: CharId;
  amount: number;
  seq: number;
}

/**
 * The shared board (CLAUDE.md §4): objectives, threats, and the vampire roster —
 * visible to everyone. The calm dossier layer — no ambient motion — with one exception:
 * when Blood is shared between vampires, a crimson arc streaks across the roster from
 * giver to receiver (the one-at-a-time slide-over sheet can't show both, but the board
 * always shows the whole crew), so the table sees the gift land (DESIGN.md §6).
 */
export function Board({
  state,
  online,
  events,
  mySeat,
  isGm,
  turnControls,
  onOpenSheet,
  onFrameScene,
}: {
  state: GameState;
  online: SeatId[];
  events: GameEvent[];
  /** This device's own character (null for the GM / unseated), floated to the top of the rail. */
  mySeat?: CharId | null;
  /** True for the GM seat: sees staged (not-yet-activated) threats; players never do (issue #12). */
  isGm?: boolean;
  /** The "Start a turn" controls, placed atop the main column (not over the crew rail). */
  turnControls?: ReactNode;
  onOpenSheet?: (id: CharId) => void;
  /** GM-only: open the GM panel to frame the first scene (shown as an empty-state CTA). */
  onFrameScene?: () => void;
}) {
  const { reduced } = useEffects();
  const { play } = useSound();
  const crewRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastShareSeq = useRef(0);
  const [arc, setArc] = useState<ShareArc | null>(null);

  // Watch the (session-local) event feed for a fresh BLOOD_SHARED and stream the arc.
  useEffect(() => {
    let latest: GameEvent | undefined;
    for (const e of events) if (e.type === "BLOOD_SHARED" && e.seq > lastShareSeq.current) latest = e;
    if (!latest || latest.type !== "BLOOD_SHARED") return;
    lastShareSeq.current = latest.seq;
    if (reduced) return;

    const layer = crewRef.current;
    const a = cardRefs.current.get(latest.payload.from);
    const b = cardRefs.current.get(latest.payload.to);
    if (!layer || !a || !b) return;
    const lr = layer.getBoundingClientRect();
    const center = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - lr.left + r.width / 2, y: r.top - lr.top + r.height / 2 };
    };
    play("feed");
    setArc({ from: center(a), to: center(b), fromId: latest.payload.from, toId: latest.payload.to, amount: latest.payload.amount, seq: latest.seq });
  }, [events, reduced, play]);

  useEffect(() => {
    if (!arc) return;
    const t = setTimeout(() => setArc(null), 1100);
    return () => clearTimeout(t);
  }, [arc]);

  const secondary = state.board.secondaryObjectives;
  // Staged threats (issue #12) are the GM's to reveal: players never see one, so the board
  // gives no hint a staged threat exists. The GM sees every threat, staged ones flagged.
  const visibleThreats = isGm ? state.board.threats : state.board.threats.filter((t) => t.active !== false);
  const loc = state.board.locationId ? LOCATIONS_BY_ID[state.board.locationId] : undefined;
  const sceneLoot = loc?.loot ?? [];
  const empty =
    !loc &&
    state.board.objectives.length === 0 &&
    state.board.threats.length === 0 &&
    secondary.length === 0;
  // Rail order: your own character first, then the rest of the in-play crew, then the
  // unclaimed seats. Array.sort is stable, so CHAR_IDS order holds within each rank.
  const crewRank = (id: CharId) => (id === mySeat ? 0 : state.seats[id]?.claimed ? 1 : 2);
  const orderedCrew = [...CHAR_IDS].sort((a, b) => crewRank(a) - crewRank(b));
  return (
    <div className="substrate grain min-h-full p-4 pb-20 app-w">
      <div className="board-layout">
        {/* ───────── LEFT: the crew rail (issue #7) ───────── */}
        <section className="crew-rail-wrap" aria-label="F.A.N.G.">
          <h2 className="crew-rail-head">
            <span className="stamp fang-stamp">F.A.N.G.</span>
          </h2>
          <div ref={crewRef} className="crew-rail">
            {orderedCrew.map((id) => (
              <CharCard
                key={id}
                id={id}
                innerRef={(el) => {
                  if (el) cardRefs.current.set(id, el);
                  else cardRefs.current.delete(id);
                }}
                char={state.characters[id]}
                claimed={state.seats[id]?.claimed ?? false}
                online={online.includes(id)}
                active={state.activeSeat === id}
                // Whose turn (§6): the active vampire takes a warm spotlight; the rest
                // recede while someone holds the floor. A state change, not ambient motion.
                recede={!!state.activeSeat && state.activeSeat !== id && (state.seats[id]?.claimed ?? false)}
                fx={arc ? (arc.fromId === id ? "bleed" : arc.toId === id ? "flood" : undefined) : undefined}
                onOpen={onOpenSheet ? () => onOpenSheet(id) : undefined}
              />
            ))}
            {arc && <BloodArc key={arc.seq} arc={arc} />}
          </div>
        </section>

        {/* ───────── RIGHT: the board ───────── */}
        <div className="board-main min-w-0 flex flex-col gap-4">
          {turnControls}
          <BoardHeader state={state} />

          {loc && (
            <div className={`paper scene--s${loc.sector} ${paperCut(loc.id)}`}>
              <div className="mono text-[0.6rem] uppercase tracking-wide text-paper-fade">
                Scene <span className="text-paper-fade">· sector {loc.sector}</span>
              </div>
              <p className="display text-2xl leading-tight">{loc.name}</p>
            </div>
          )}

          {empty && onFrameScene && (
            <div className="paper text-center">
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

          <div className="grid gap-4 lg:grid-cols-2">
            <section>
              <h2 className="display text-paper text-xl mb-2">Objectives</h2>
              {state.board.objectives.length === 0 && <Empty>No objectives yet.</Empty>}
              <div className="grid gap-2">
                {state.board.objectives.map((o) => (
                  <div key={o.id} className={`paper paper-tight paper--objective ${paperCut(o.id)}`} style={{ transform: `rotate(${cardTilt(o.id)}deg)` }}>
                    <div className="flex items-baseline justify-between">
                      <span className="mono font-bold">{o.name}</span>
                      <RatingPips n={o.rating} tone="hazard" />
                    </div>
                    {o.challenge ? <div className="mono text-[0.6rem] text-paper-fade mt-0.5">challenge {o.challenge}</div> : null}
                  </div>
                ))}
              </div>

              {secondary.length > 0 && (
                <div className="mt-3">
                  <h3 className="mono text-[0.7rem] uppercase tracking-wide text-paper-fade mb-1.5">Secondary objectives</h3>
                  <div className="grid gap-2">
                    {secondary.map((o) => {
                      const done = o.rating <= 0;
                      return (
                        <div key={o.id} className={`paper paper-tight paper--objective ${paperCut(o.id)} ${done ? "opacity-60" : ""}`} style={{ transform: `rotate(${cardTilt(o.id)}deg)` }}>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className={`mono ${done ? "line-through" : ""}`}>
                              {o.name}
                              {o.rescueFor && <span className="text-blood"> (rescue)</span>}
                            </span>
                            {done ? <span className="mono text-[0.6rem] text-hazard-ink font-bold">done</span> : <RatingPips n={o.rating} tone="hazard" />}
                          </div>
                          {!done && o.challenge ? <div className="mono text-[0.6rem] text-paper-fade mt-0.5">challenge {o.challenge}</div> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <section>
              <h2 className="display text-paper text-xl mb-2">Threats</h2>
              {visibleThreats.length === 0 && <Empty>The street is quiet. For now.</Empty>}
              <div className="grid gap-2">
                {visibleThreats.map((t) => {
                  // Only ever true for the GM (players never receive staged threats): a held-back
                  // threat, dimmed and flagged so the GM can tell it isn't in the fight yet.
                  const staged = t.active === false;
                  return (
                    <div key={t.id} className={`paper paper-tight paper--threat ${paperCut(t.id)} ${t.rating <= 0 || staged ? "opacity-50" : ""}`} style={{ transform: `rotate(${cardTilt(t.id)}deg)` }}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="mono font-bold">
                          {t.name}
                          {staged && <span className="mono text-[0.55rem] uppercase tracking-wide text-paper-fade border border-current px-1 ml-1.5 align-middle">staged</span>}
                        </span>
                        <span className="mono text-xs text-blood">ATK {t.attack}</span>
                      </div>
                      <RatingPips n={t.rating} tone="blood" />
                      {t.challenge ? <div className="mono text-[0.6rem] text-paper-fade mt-0.5">challenge {t.challenge}</div> : null}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Loot spans the full board width below both columns, two-up (issue #7). */}
          {sceneLoot.length > 0 && (
            <section>
              <h3 className="mono text-[0.7rem] uppercase tracking-wide text-paper-fade mb-1.5">Loot within reach</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {sceneLoot.map((l, i) => (
                  <div key={i} className={`paper paper-tight ${paperCut(`loot-${l.name}`)}`} style={{ transform: `rotate(${cardTilt(`loot-${l.name}`)}deg)` }}>
                    <div className="mono font-bold text-sm">{l.name}</div>
                    {l.bonus && <div className="mono text-[0.65rem] text-blood">{l.bonus}</div>}
                    {l.note && <div className="mono text-[0.65rem] text-paper-fade italic">{l.note}</div>}
                  </div>
                ))}
              </div>
              <p className="mono text-[0.6rem] text-paper-fade mt-1">The GM hands these out as you earn them (rulebook p39).</p>
            </section>
          )}
        </div>
      </div>
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
  innerRef,
  char,
  claimed,
  online,
  active,
  recede,
  fx,
  onOpen,
}: {
  id: string;
  innerRef?: (el: HTMLDivElement | null) => void;
  char: CharacterRuntime;
  claimed: boolean;
  online: boolean;
  active: boolean;
  recede: boolean;
  /** A blood-share one-shot: the giver bleeds, the receiver floods (§6). */
  fx?: "bleed" | "flood";
  onOpen?: () => void;
}) {
  // As injuries pile up (0–6 boxes marked), the card drains of colour toward grey —
  // a vampire visibly fading. A blood-share fx (card-bleed/flood) momentarily overrides
  // the filter, then it returns when that class drops.
  const wear = Math.min(1, char.injuries.reduce((s, n) => s + n, 0) / 6);
  // Loose-paper tilt, composed with the downed "knocked-over" lean and the active lift —
  // a single inline transform so it doesn't fight the Tailwind -rotate-1 it used to use.
  const tilt = cardTilt(id) + (char.downed ? -1.2 : 0);
  const transform = active ? `rotate(${tilt}deg) translateY(-3px) scale(1.02)` : `rotate(${tilt}deg)`;
  return (
    <div
      ref={innerRef}
      className={`paper ${paperCut(id)} ${onOpen ? "cursor-pointer" : ""} ${char.dead ? "opacity-40" : char.downed ? "opacity-70" : ""} ${fx ? `card-${fx}` : ""}`}
      style={{
        transition: "transform 220ms var(--ease-impact), box-shadow 220ms, opacity 220ms, filter 220ms",
        transform,
        ...(wear > 0 ? { filter: `grayscale(${(wear * 0.85).toFixed(2)}) brightness(${(1 - wear * 0.12).toFixed(2)})` } : {}),
        ...(active ? { boxShadow: "0 0 0 2px var(--hazard-warm), 0 0 28px rgba(232,148,28,0.35), 0 14px 28px rgba(0,0,0,0.55)" } : {}),
        ...(recede ? { opacity: 0.62 } : {}),
      }}
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

/**
 * The blood-share spectacle (§6): a thrown crimson arc + a stream of droplets from the
 * giver's card to the receiver's, with the gifted amount floating up at the landing.
 * One-shot; positions are measured from the live card rects so it tracks the layout.
 */
function BloodArc({ arc }: { arc: ShareArc }) {
  const { from, to, amount } = arc;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  // Lift the apex perpendicular to the line so the gift is lobbed, not dragged.
  const lift = Math.min(90, Math.max(34, dist * 0.22));
  const mid = { x: (from.x + to.x) / 2 + (-dy / dist) * lift, y: (from.y + to.y) / 2 + (dx / dist) * lift };
  const path = `M ${from.x} ${from.y} Q ${mid.x} ${mid.y} ${to.x} ${to.y}`;

  return (
    <div className="blood-arc" aria-hidden>
      <svg className="blood-arc__svg">
        <motion.path
          d={path}
          fill="none"
          stroke="var(--blood-bright)"
          strokeWidth={2.5}
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: [0, 0.85, 0] }}
          transition={{ duration: 0.85, ease: [0.2, 0.7, 0.2, 1] }}
        />
      </svg>
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="blood-drop"
          initial={{ x: from.x, y: from.y, opacity: 0, scale: 0.5 }}
          animate={{ x: [from.x, mid.x, to.x], y: [from.y, mid.y, to.y], opacity: [0, 1, 1, 0], scale: [0.5, 1, 0.85] }}
          transition={{ duration: 0.8, delay: i * 0.09, ease: "easeInOut" }}
        />
      ))}
      <motion.span
        className="blood-amount display"
        initial={{ x: to.x, y: to.y, opacity: 0 }}
        animate={{ x: to.x, y: [to.y, to.y - 28], opacity: [0, 1, 1, 0] }}
        transition={{ duration: 1, delay: 0.5, ease: "easeOut" }}
      >
        +{amount}
      </motion.span>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="mono text-sm text-paper-fade italic">{children}</p>;
}
