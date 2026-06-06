import { useCallback, useEffect, useRef, useState } from "react";
import type { DieFace } from "@shared/domain/types.js";
import { Die, type DieVisualState } from "@/components/dice/Die";
import "./dice-arena.css";

/**
 * The craps-table throw (issue #5, DESIGN.md §5/§6 — "rolling dice feels like setting off a
 * bomb"). A pool is hurled across the *live board* (this layer is transparent and sits over
 * the dossier, not inside the dark theater): the dice fly out from a low cup in a wide spray,
 * ricochet off the screen edges *and off each other*, then friction grips them to rest where
 * they fall — and the faces flare (successes hazard-yellow, the crit crimson). Pure spectacle:
 * the values are the server's; only the *path* is local physics, so each client scatters its
 * own way.
 *
 * A lightweight top-down 2D sim per DESIGN.md §7 ("the feel of weight is what matters"):
 * friction + four-wall restitution + equal-mass die-die collisions (a settled die is a fixed
 * obstacle the others bounce off). Bodies live in refs and are driven imperatively (one
 * transform write per die per frame); React only re-renders a die when it settles, to swap
 * its face from a motion blur to its true, coloured value. The rAF loop is owned by a mount
 * effect with a real cleanup so it survives React StrictMode's double-invoke.
 */

export interface ThrowSpec {
  id: string;
  kind: "player" | "gm";
  dice: DieFace[];
}

interface ViewDie {
  key: string;
  kind: "player" | "gm";
  finalFace: DieFace;
  size: number;
  settled: boolean;
}

interface Body {
  throwId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  settled: boolean;
  restMs: number;
  ageMs: number;
}

// Top-down felt, not a side wall: no gravity. Dice are flung out fast, ricochet off the four
// edges and off each other, and friction grips them to a stop scattered across the screen.
const FRICTION_RATE = 1.7; // per-second exponential velocity decay
const WALL_REST = 0.74; // energy retained on an edge bounce (lively ricochets)
const DIE_REST = 0.85; // energy retained when two dice collide (elastic — they knock each
//                        other and clatter, but keep their momentum and reach the walls)
const LAUNCH_GRACE = 95; // ms before a die can collide — lets the cluster clear the cup first
const EDGE = 16; // side inset
const TOP_INSET = 64; // keep dice clear of the sticky top bar
const BOTTOM_INSET = 92; // keep dice clear of the always-on safety bar (footer)
const SETTLE_SPEED = 55; // px/s below which a die starts to grip (cuts the long end-slide)
const SETTLE_MS = 105; // how long it must idle before it counts as rested
const FAILSAFE_MS = 4000; // hard cap so a die ALWAYS settles (never strands the turn)

function playerVisual(face: DieFace): DieVisualState {
  if (face === 6) return "critical";
  if (face >= 4) return "success";
  return "normal";
}
function gmVisual(face: DieFace): DieVisualState {
  return face >= 4 ? "success" : "normal";
}

export function DiceArena({
  throws,
  fading,
  onThrowSettled,
}: {
  throws: ThrowSpec[];
  /** Fade the whole arena out (the dice clear so the results panel can take over). */
  fading?: boolean;
  /** Fires once every die of a throw has come to rest (immediately for an empty pool). */
  onThrowSettled?: (id: string) => void;
}) {
  const [view, setView] = useState<ViewDie[]>([]);
  const bodies = useRef<Map<string, Body>>(new Map());
  const els = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const launched = useRef<Set<string>>(new Set());
  const reported = useRef<Set<string>>(new Set());
  const throwIds = useRef<Set<string>>(new Set());
  const settledCb = useRef(onThrowSettled);
  settledCb.current = onThrowSettled;

  const report = useCallback((id: string) => {
    if (reported.current.has(id)) return;
    reported.current.add(id);
    settledCb.current?.(id);
  }, []);

  // Launch any throw we haven't yet (the player's on mount; the Reich's when the GM rolls).
  // Pure data + DOM-state setup; the loop below picks the new bodies up on its next frame.
  useEffect(() => {
    const appended: ViewDie[] = [];
    for (const t of throws) {
      if (launched.current.has(t.id)) continue;
      launched.current.add(t.id);

      if (t.dice.length === 0) {
        // Nothing to throw (an uncontested Reich pool) — settled by definition.
        queueMicrotask(() => report(t.id));
        continue;
      }

      throwIds.current.add(t.id);
      const w = window.innerWidth;
      const h = window.innerHeight;
      t.dice.forEach((face, i) => {
        const key = `${t.id}-${i}`;
        const size = t.kind === "player" ? 56 : 46;
        // A handful flung hard from a low cup (above the footer) in a wide upward spray, so
        // they cross the felt and ricochet off the walls and each other before settling. The
        // cup is given a little spread (and a collision grace, below) so the dice don't just
        // bonk each other dead on the way out — they fly far, then clatter.
        const startX = w * (0.5 + (Math.random() - 0.5) * 0.34);
        const startY = h - size - BOTTOM_INSET - Math.random() * 56;
        const angle = (-90 + (Math.random() - 0.5) * 168) * (Math.PI / 180); // upward fan ±84°
        const speed = 2500 + Math.random() * 1300;
        bodies.current.set(key, {
          throwId: t.id,
          x: startX,
          y: startY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          rot: Math.random() * 360,
          vrot: (Math.random() - 0.5) * 1900,
          size,
          settled: false,
          restMs: 0,
          ageMs: 0,
        });
        appended.push({ key, kind: t.kind, finalFace: face, size, settled: false });
      });
    }
    if (appended.length) setView((cur) => [...cur, ...appended]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [throws]);

  // The physics loop — runs continuously while mounted and picks up new bodies as they're
  // launched. A mount effect with a real cleanup, so StrictMode's setup→cleanup→setup leaves
  // exactly one live rAF.
  useEffect(() => {
    let frame = 0;
    let last: number | null = null;
    const step = (t: number) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dt = last == null ? 1 / 60 : Math.min(0.033, (t - last) / 1000);
      last = t;
      const arr = Array.from(bodies.current.values());

      // 1) Integrate + bounce off the four edges.
      for (const b of arr) {
        if (b.settled) continue;
        b.ageMs += dt * 1000;
        const damp = Math.exp(-FRICTION_RATE * dt);
        b.vx *= damp;
        b.vy *= damp;
        b.vrot *= damp;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.rot += b.vrot * dt;

        const rightWall = w - b.size - EDGE;
        const bottomWall = h - b.size - BOTTOM_INSET;
        if (b.x <= EDGE) {
          b.x = EDGE;
          b.vx = Math.abs(b.vx) * WALL_REST;
          b.vrot *= 0.86;
        } else if (b.x >= rightWall) {
          b.x = rightWall;
          b.vx = -Math.abs(b.vx) * WALL_REST;
          b.vrot *= 0.86;
        }
        if (b.y <= TOP_INSET) {
          b.y = TOP_INSET;
          b.vy = Math.abs(b.vy) * WALL_REST;
          b.vrot *= 0.86;
        } else if (b.y >= bottomWall) {
          b.y = bottomWall;
          b.vy = -Math.abs(b.vy) * WALL_REST;
          b.vrot *= 0.86;
        }
      }

      // 2) Die-die collisions (equal mass; a settled die is a fixed obstacle).
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i]!;
          const b = arr[j]!;
          if (a.settled && b.settled) continue;
          // Grace: a freshly-launched die ignores collisions until it has cleared the cup,
          // so the cluster sprays apart instead of cancelling its own momentum at the start.
          if (a.ageMs < LAUNCH_GRACE || b.ageMs < LAUNCH_GRACE) continue;
          const ar = a.size / 2;
          const br = b.size / 2;
          const dx = b.x + br - (a.x + ar);
          const dy = b.y + br - (a.y + ar);
          const d = Math.hypot(dx, dy);
          const minD = (ar + br) * 0.98;
          if (d >= minD || d === 0) continue;

          const nx = dx / d;
          const ny = dy / d;
          const overlap = minD - d;
          // Push apart so they never rest overlapping.
          if (a.settled) {
            b.x += nx * overlap;
            b.y += ny * overlap;
          } else if (b.settled) {
            a.x -= nx * overlap;
            a.y -= ny * overlap;
          } else {
            a.x -= (nx * overlap) / 2;
            a.y -= (ny * overlap) / 2;
            b.x += (nx * overlap) / 2;
            b.y += (ny * overlap) / 2;
          }

          const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rvn < 0) {
            if (a.settled) {
              const jImp = -(1 + DIE_REST) * rvn;
              b.vx += jImp * nx;
              b.vy += jImp * ny;
            } else if (b.settled) {
              const jImp = -(1 + DIE_REST) * rvn;
              a.vx -= jImp * nx;
              a.vy -= jImp * ny;
            } else {
              const jImp = (-(1 + DIE_REST) * rvn) / 2;
              a.vx -= jImp * nx;
              a.vy -= jImp * ny;
              b.vx += jImp * nx;
              b.vy += jImp * ny;
            }
            // A knock sends a little spin through the dice — the craps clatter.
            if (!a.settled) a.vrot += (Math.random() - 0.5) * 220;
            if (!b.settled) b.vrot += (Math.random() - 0.5) * 220;
          }
        }
      }

      // 3) Settle detection (after collisions) + the imperative transform write.
      let viewDirty = false;
      bodies.current.forEach((b, key) => {
        if (!b.settled) {
          const speed = Math.hypot(b.vx, b.vy);
          if (speed < SETTLE_SPEED && Math.abs(b.vrot) < 80) b.restMs += dt * 1000;
          else b.restMs = 0;
          if (b.restMs >= SETTLE_MS || b.ageMs >= FAILSAFE_MS) {
            b.settled = true;
            b.vx = b.vy = b.vrot = 0;
            viewDirty = true;
          }
        }
        const el = els.current.get(key);
        if (el) el.style.transform = `translate3d(${b.x}px, ${b.y}px, 0) rotate(${b.rot}deg)`;
      });

      if (viewDirty) {
        setView((cur) =>
          cur.map((d) => (bodies.current.get(d.key)?.settled && !d.settled ? { ...d, settled: true } : d)),
        );
      }

      // Per-throw completion: report the moment all of a throw's dice have come to rest.
      for (const tid of throwIds.current) {
        if (reported.current.has(tid)) continue;
        let total = 0;
        let rested = 0;
        bodies.current.forEach((b) => {
          if (b.throwId !== tid) return;
          total++;
          if (b.settled) rested++;
        });
        if (total > 0 && rested === total) report(tid);
      }

      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [report]);

  return (
    <div className={`dice-arena ${fading ? "dice-arena--fading" : ""}`} aria-hidden>
      {view.map((d) => (
        <div
          key={d.key}
          ref={(el) => {
            els.current.set(d.key, el);
            // Place the die at its current physics position the instant it attaches, so it
            // never flashes at the top-left corner before the first animation frame, and so
            // a settle re-render re-applies the rest transform rather than snapping to 0,0.
            const b = bodies.current.get(d.key);
            if (el && b) el.style.transform = `translate3d(${b.x}px, ${b.y}px, 0) rotate(${b.rot}deg)`;
          }}
          className="dice-arena__die"
        >
          <div className={`${d.settled ? "" : "dice-arena__flying"} ${d.settled && d.kind === "player" && d.finalFace === 6 ? "crit-pop" : ""}`}>
            <Die
              kind={d.kind}
              value={d.finalFace}
              state={d.settled ? (d.kind === "player" ? playerVisual(d.finalFace) : gmVisual(d.finalFace)) : "normal"}
              tilt={0}
              size={`${d.size}px`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
