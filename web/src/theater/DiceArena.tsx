import { useCallback, useEffect, useRef, useState } from "react";
import type { DieFace } from "@shared/domain/types.js";
import { Die, type DieVisualState } from "@/components/dice/Die";
import "./dice-arena.css";

/**
 * The craps-table throw (issue #5, DESIGN.md §5/§6 — "rolling dice feels like setting off a
 * bomb"). A pool is hurled across the *live board* (this layer is transparent and sits over
 * the dossier, not inside the dark theater): the dice fly out from a low cup, ricochet off
 * the screen edges, and friction slides them to rest scattered across the felt — then their
 * faces flare (successes hazard-yellow, the crit crimson). Pure spectacle: the values are
 * the server's; only the *path* is local physics, so each client scatters its own way.
 *
 * A lightweight top-down 2D sim (friction + four-wall restitution, no die-die collision) per
 * DESIGN.md §7 — "the feel of weight is what matters." Bodies live in refs and are driven
 * imperatively (one transform write per die per frame); React only re-renders a die when it
 * settles, to swap its face from a motion blur to its true, coloured value. The rAF loop is
 * owned by a mount effect with a real cleanup so it survives React StrictMode's double-invoke.
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

// Top-down felt, not a side wall: no gravity. Dice are flung out, ricochet off all four
// edges, and a velocity-proportional friction slides them to rest scattered across the
// whole screen (a craps table), rather than piling along one edge.
const FRICTION_RATE = 2.4; // per-second exponential velocity decay (higher = grippier felt)
const WALL_REST = 0.55; // energy retained on an edge bounce
const EDGE = 16; // side inset
const TOP_INSET = 64; // keep dice clear of the sticky top bar
const BOTTOM_INSET = 92; // keep dice clear of the always-on safety bar (footer)
const SETTLE_SPEED = 48; // px/s below which a die is "coming to rest" (grips, no long creep)
const SETTLE_MS = 80; // how long it must idle before it counts as rested
const FAILSAFE_MS = 3600; // hard cap so a die ALWAYS settles (never strands the turn)

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
        // Flung from a low cup (above the footer), but aimed at a random spot across the
        // whole felt: with exponential friction a die's travel ≈ v0 / FRICTION_RATE, so we
        // set the launch speed from the distance to that spot (± a little overshoot). This
        // keeps the scatter full and even no matter how grippy the felt is — and the dice
        // still ricochet off the walls and spin on the way, just without a long end-slide.
        const startX = w * (0.5 + (Math.random() - 0.5) * 0.3);
        const startY = h - size - BOTTOM_INSET;
        const targetX = EDGE + Math.random() * (w - 2 * EDGE - size);
        const targetY = TOP_INSET + Math.random() * (startY - TOP_INSET);
        const dx = targetX - startX;
        const dy = targetY - startY;
        const dist = Math.hypot(dx, dy) || 1;
        const speed = dist * FRICTION_RATE * (0.9 + Math.random() * 0.5);
        bodies.current.set(key, {
          throwId: t.id,
          x: startX,
          y: startY,
          vx: (dx / dist) * speed,
          vy: (dy / dist) * speed,
          rot: Math.random() * 360,
          vrot: (Math.random() - 0.5) * 1800,
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
  // exactly one live rAF (the previous gated/ref design stranded itself on the second mount).
  useEffect(() => {
    let frame = 0;
    let last: number | null = null;
    const step = (t: number) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dt = last == null ? 1 / 60 : Math.min(0.033, (t - last) / 1000);
      last = t;

      let viewDirty = false;
      bodies.current.forEach((b, key) => {
        if (!b.settled) {
          b.ageMs += dt * 1000;

          const damp = Math.exp(-FRICTION_RATE * dt);
          b.vx *= damp;
          b.vy *= damp;
          b.vrot *= damp;

          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.rot += b.vrot * dt;

          const leftWall = EDGE;
          const rightWall = w - b.size - EDGE;
          const topWall = TOP_INSET;
          const bottomWall = h - b.size - BOTTOM_INSET;

          if (b.x <= leftWall) {
            b.x = leftWall;
            b.vx = Math.abs(b.vx) * WALL_REST;
            b.vrot *= 0.85;
          } else if (b.x >= rightWall) {
            b.x = rightWall;
            b.vx = -Math.abs(b.vx) * WALL_REST;
            b.vrot *= 0.85;
          }
          if (b.y <= topWall) {
            b.y = topWall;
            b.vy = Math.abs(b.vy) * WALL_REST;
            b.vrot *= 0.85;
          } else if (b.y >= bottomWall) {
            b.y = bottomWall;
            b.vy = -Math.abs(b.vy) * WALL_REST;
            b.vrot *= 0.85;
          }

          const speed = Math.hypot(b.vx, b.vy);
          if (speed < SETTLE_SPEED && Math.abs(b.vrot) < 60) b.restMs += dt * 1000;
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
