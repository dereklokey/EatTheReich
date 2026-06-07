import { Fragment, type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { DieFace } from "@shared/domain/types.js";
import { Die, type DieVisualState } from "@/components/dice/Die";
import "./dice-arena.css";

/**
 * The craps-table throw (issue #5, DESIGN.md §5/§6 — "rolling dice feels like setting off a
 * bomb"). A pool is hurled across the *live board* (this layer is transparent and sits over
 * the dossier, not inside the dark theater): the two sides come in from opposite wings — the
 * player's dice fly in from the LEFT edge, the Reich's from the RIGHT — and crucially they
 * come in *out of the air*, not skating along the felt. They arc down, hit the felt, and
 * BOUNCE; each hop and each wall hit bleeds a chunk of speed and — because a die never lands
 * perfectly flat — kicks a fresh spin through it. So the hops get shorter and shorter until
 * the grippy (non-slippery) felt grinds the last of the motion out and they rest, faces
 * flaring (successes hazard-yellow, the crit crimson). Pure spectacle: the values are the
 * server's; only the *path* is local physics, so each client scatters its own way.
 *
 * The sim is top-down with a real height channel (`z`, px above the felt, drawn as a vertical
 * lift + a scale-up + a separating contact shadow). In the air there's almost no friction —
 * only gravity; the speed is shed in discrete bites at each felt/wall *contact*, never as a
 * continuous glide. That air-vs-contact split is the whole difference between a roll and a
 * slide. Bodies live in refs and are driven imperatively (one transform write per die per
 * frame); React only re-renders a die when it settles, to swap its face from a motion blur to
 * its true, coloured value. The rAF loop is owned by a mount effect with a real cleanup so it
 * survives React StrictMode's double-invoke.
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
  x: number; // felt-plane position (the die's footprint / shadow point)
  y: number;
  z: number; // height above the felt (>0 = airborne)
  vx: number;
  vy: number;
  vz: number; // vertical velocity (up = positive)
  rot: number; // flat yaw (deg) — the die's in-plane turn
  spin: number; // yaw rate (deg/s), re-kicked at every impact
  tx: number; // tumble pitch (deg, rotateX) — end-over-end flip toward/away from camera
  ty: number; // tumble roll (deg, rotateY) — flip left/right
  vtx: number; // tumble pitch rate (deg/s)
  vty: number; // tumble roll rate (deg/s)
  size: number;
  settled: boolean;
  entered: boolean; // has it crossed in from off-screen? (no walls/landing until it has)
  restMs: number;
  ageMs: number;
}

// Top-down felt with a height channel. Dice arc in out of the air; gravity pulls them down,
// the felt bounces them, and speed is shed only on contact — almost frictionless mid-air, but
// a grippy felt once they're down.
const GRAVITY = 2800; // px/s² pulling the die back to the felt
const AIR_DRAG = 0.12; // per-second horizontal decay while airborne — nearly none
const GROUND_FRICTION = 7.5; // per-second horizontal decay once grounded — grippy, not slippery
const FELT_REST = 0.5; // vertical restitution: each felt bounce keeps ~half its drop speed
const FELT_GRIP = 0.56; // horizontal speed kept through a felt landing (the felt bites)
const WALL_REST = 0.6; // horizontal restitution on an edge hit (loses energy + kicks spin)
const MIN_HOP = 150; // px/s of downward speed below which a contact rests instead of hopping
const GROUND_EPS = 0.8; // z (px) at/under which the die counts as on the felt
const DIE_REST = 0.85; // energy retained when two grounded dice clatter together
const DIE_COLLIDE_Z = 22; // dice only block each other when both are this low (else one's airborne)
const SPIN_PER_SPEED = 0.5; // deg/s of imparted yaw per px/s of speed at an impact
const AIR_SPIN_DECAY = 0.2; // per-second bleed of spin/tumble in the air — barely any (it whirls)
const GROUND_SPIN_DECAY = 14; // per-second bleed once grounded — flattens out fast to lie face-up
const TUMBLE_REST = 0.5; // tumble energy kept through a felt impact (then re-kicked off-flat)
const TUMBLE_PER_SPEED = 0.85; // deg/s of imparted tumble per px/s of speed at an impact
const LAUNCH_TUMBLE = 1500; // deg/s spread of the askew launch tumble — the die leaves the hand spinning
const PERSPECTIVE = 620; // px — the foreshortening that makes rotateX/Y read as a real tumble
const LAUNCH_GRACE = 95; // ms before a die can collide — lets the handful clear first
const EDGE = 16; // side inset
const TOP_INSET = 64; // keep dice clear of the sticky top bar
const BOTTOM_INSET = 92; // keep dice clear of the always-on safety bar (footer)
const SETTLE_SPEED = 40; // px/s below which a grounded die grips to rest
const SETTLE_MS = 90; // how long it must idle (grounded) before it counts as rested
const FAILSAFE_MS = 4000; // hard cap so a die ALWAYS settles (never strands the turn)
const HEIGHT_SCALE = 0.0011; // how much a die grows per px of height (a depth cue)
const SHADOW_FADE = 340; // height at which the contact shadow is fully spread & faint

// A not-quite-flat impact throws a fresh spin through the die, handed and scaled to how fast
// it's still travelling — so the first hard hops whirl and the last slow ones barely turn.
function impactSpin(hspeed: number): number {
  return (Math.random() < 0.5 ? -1 : 1) * (hspeed * SPIN_PER_SPEED + 60 + Math.random() * 160);
}
// A tumble kick (deg/s) for an off-flat impact — same idea, but it can land either handedness.
function impactTumble(hspeed: number): number {
  return (Math.random() - 0.5) * 2 * (hspeed * TUMBLE_PER_SPEED + 120);
}

// Paint a die's three elements from its body. The OUTER box carries the screen position and
// the height scale-up (a flat 2D transform); the CUBE carries the perspective + the 3D tumble
// (so a real solid cube pitches and rolls, never a flat coin); the SHADOW rides the felt,
// spreading & fading as the die climbs. One source of truth, shared by the rAF loop and the
// ref-attach callbacks. Pure over the body + elements — no component state.
function paint(
  b: Body,
  outerEl: HTMLDivElement | null,
  cubeEl: HTMLDivElement | null,
  shEl: HTMLDivElement | null,
): void {
  if (outerEl) {
    const scale = 1 + b.z * HEIGHT_SCALE;
    outerEl.style.transform = `translate3d(${b.x}px, ${(b.y - b.z).toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
  }
  if (cubeEl) {
    // perspective() before the rotations foreshortens the cube, so its faces read as a solid
    // die tumbling end-over-end rather than a flat card skewing.
    cubeEl.style.transform =
      `perspective(${PERSPECTIVE}px) rotateX(${b.tx.toFixed(1)}deg) rotateY(${b.ty.toFixed(1)}deg) rotateZ(${b.rot.toFixed(1)}deg)`;
  }
  if (shEl) {
    const t = Math.min(1, b.z / SHADOW_FADE);
    const ss = 1 + t * 0.5;
    shEl.style.transform = `translate3d(${b.x}px, ${b.y + b.size * 0.12}px, 0) scale(${ss.toFixed(3)})`;
    shEl.style.opacity = (0.42 * (1 - t * 0.62)).toFixed(3);
  }
}

// A valid d6 layout for the cube: the rolled value up front, 7−value on the back, and the two
// remaining complementary pairs on the side axes — so every face shows a real number and
// opposite faces sum to 7, the way a die actually reads as it tumbles (no blank sides, and the
// landing settles through real values instead of flashing the one face against blanks).
const SEVEN_PAIRS: [DieFace, DieFace][] = [
  [1, 6],
  [2, 5],
  [3, 4],
];
function cubeFaces(value: DieFace): {
  front: DieFace;
  back: DieFace;
  top: DieFace;
  bottom: DieFace;
  right: DieFace;
  left: DieFace;
} {
  const [p, q] = SEVEN_PAIRS.filter(([a, b]) => a !== value && b !== value);
  return { front: value, back: (7 - value) as DieFace, top: p![0], bottom: p![1], right: q![0], left: q![1] };
}

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
  const els = useRef<Map<string, HTMLDivElement | null>>(new Map()); // outer position box
  const cubes = useRef<Map<string, HTMLDivElement | null>>(new Map()); // the 3D-rotating cube
  const shadows = useRef<Map<string, HTMLDivElement | null>>(new Map());
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
      const fromLeft = t.kind === "player";
      t.dice.forEach((face, i) => {
        const key = `${t.id}-${i}`;
        const size = t.kind === "player" ? 56 : 46;
        // A handful lobbed in from one wing and ABOVE the felt — the player's from off the LEFT,
        // the Reich's from off the RIGHT — high in the air with a little upward toss, so they
        // arc down, land somewhere out on the felt, and bounce across it. They start off-screen
        // (no walls/landing until they've crossed in, below) so the throw visibly flies in.
        const fieldTop = TOP_INSET;
        const fieldBottom = h - size - BOTTOM_INSET;
        const startX = fromLeft ? -size - Math.random() * 60 : w + Math.random() * 60;
        const startY = (fieldTop + fieldBottom) / 2 + (Math.random() - 0.5) * (fieldBottom - fieldTop) * 0.72;
        const hspeed = 1000 + Math.random() * 900; // inward dash across the felt
        bodies.current.set(key, {
          throwId: t.id,
          x: startX,
          y: startY,
          z: 170 + Math.random() * 200, // up in the air
          vx: (fromLeft ? 1 : -1) * hspeed,
          vy: (Math.random() - 0.5) * hspeed * 0.45, // a little depth drift
          vz: 60 + Math.random() * 220, // a slight toss up before gravity takes it
          rot: Math.random() * 360,
          spin: impactSpin(hspeed),
          // Leaves the hand ALREADY askew and tumbling — real dice never launch flat, and the
          // release drags a spin onto them. Barely decays in the air, so it whirls the whole arc.
          tx: (Math.random() - 0.5) * 70,
          ty: (Math.random() - 0.5) * 70,
          vtx: (Math.random() - 0.5) * LAUNCH_TUMBLE,
          vty: (Math.random() - 0.5) * LAUNCH_TUMBLE,
          size,
          settled: false,
          entered: false,
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

      // 1) Integrate height + horizontal, then resolve felt landings and wall hits.
      for (const b of arr) {
        if (b.settled) continue;
        b.ageMs += dt * 1000;

        // Horizontal: almost frictionless in the air, grippy once it's down on the felt.
        const grounded = b.entered && b.z <= GROUND_EPS && Math.abs(b.vz) < MIN_HOP;
        const hdamp = Math.exp(-(grounded ? GROUND_FRICTION : AIR_DRAG) * dt);
        b.vx *= hdamp;
        b.vy *= hdamp;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        // Height: gravity only.
        b.vz -= GRAVITY * dt;
        b.z += b.vz * dt;

        // Yaw + tumble run off their own kicks. In the air they barely decay — the die whirls
        // and pitches the whole arc. Once it's down on the felt it can't tumble, so both the
        // spin and the tilt bleed out fast, easing the die flat to lie face-up.
        b.rot += b.spin * dt;
        b.tx += b.vtx * dt;
        b.ty += b.vty * dt;
        if (grounded) {
          // A grounded die isn't tumbling through faces any more — kill the tumble velocity
          // outright and just rock the remaining tilt flat, so it rolls to its face and stops
          // instead of whirring through values on the felt.
          const gd = Math.exp(-GROUND_SPIN_DECAY * dt);
          b.spin *= gd;
          b.vtx = b.vty = 0;
          b.tx *= gd;
          b.ty *= gd;
        } else {
          const ad = Math.exp(-AIR_SPIN_DECAY * dt);
          b.spin *= ad;
          b.vtx *= ad;
          b.vty *= ad;
        }

        // Felt landing (only once it's flown in over the felt). A real impact bounces, the felt
        // bites its horizontal speed, and the off-flat hit kicks a fresh spin and tumble; a
        // feeble contact just rests it on the surface.
        if (b.entered && b.z <= 0) {
          b.z = 0;
          if (b.vz < -MIN_HOP) {
            b.vz = -b.vz * FELT_REST;
            b.vx *= FELT_GRIP;
            b.vy *= FELT_GRIP;
            const hs = Math.hypot(b.vx, b.vy);
            b.spin = impactSpin(hs);
            b.vtx = b.vtx * TUMBLE_REST + impactTumble(hs);
            b.vty = b.vty * TUMBLE_REST + impactTumble(hs);
          } else {
            b.vz = 0;
          }
        }

        const rightWall = w - b.size - EDGE;
        const bottomWall = h - b.size - BOTTOM_INSET;
        // Fly in from off-screen: ignore the walls until the die has crossed into the felt.
        if (!b.entered) {
          if (b.x >= EDGE && b.x <= rightWall) b.entered = true;
          continue;
        }
        let hitWall = false;
        if (b.x <= EDGE) {
          b.x = EDGE;
          b.vx = Math.abs(b.vx) * WALL_REST;
          hitWall = true;
        } else if (b.x >= rightWall) {
          b.x = rightWall;
          b.vx = -Math.abs(b.vx) * WALL_REST;
          hitWall = true;
        }
        if (b.y <= TOP_INSET) {
          b.y = TOP_INSET;
          b.vy = Math.abs(b.vy) * WALL_REST;
          hitWall = true;
        } else if (b.y >= bottomWall) {
          b.y = bottomWall;
          b.vy = -Math.abs(b.vy) * WALL_REST;
          hitWall = true;
        }
        if (hitWall) {
          const hs = Math.hypot(b.vx, b.vy);
          b.spin = impactSpin(hs);
          b.vtx += impactTumble(hs);
          b.vty += impactTumble(hs);
        }
      }

      // 2) Die-die collisions — only between dice both low enough to be sharing the felt (a die
      // up in the air sails over a settled one). Equal mass; a settled die is a fixed obstacle.
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i]!;
          const b = arr[j]!;
          if (a.settled && b.settled) continue;
          if (a.ageMs < LAUNCH_GRACE || b.ageMs < LAUNCH_GRACE) continue;
          if (a.z > DIE_COLLIDE_Z || b.z > DIE_COLLIDE_Z) continue;
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
            // The knock throws a little spin through both — the craps clatter.
            const kick = Math.abs(rvn) * SPIN_PER_SPEED;
            if (!a.settled) a.spin += (Math.random() < 0.5 ? -1 : 1) * kick;
            if (!b.settled) b.spin += (Math.random() < 0.5 ? -1 : 1) * kick;
          }
        }
      }

      // 3) Settle detection (a grounded, near-stopped die grips) + the imperative paint.
      let viewDirty = false;
      bodies.current.forEach((b, key) => {
        if (!b.settled) {
          const grounded = b.z <= GROUND_EPS && Math.abs(b.vz) < MIN_HOP;
          const speed = Math.hypot(b.vx, b.vy);
          if (b.entered && grounded && speed < SETTLE_SPEED) b.restMs += dt * 1000;
          else b.restMs = 0;
          if (b.restMs >= SETTLE_MS || b.ageMs >= FAILSAFE_MS) {
            b.settled = true;
            b.z = 0;
            b.vx = b.vy = b.vz = b.spin = 0;
            b.tx = b.ty = b.vtx = b.vty = 0; // snap flat — it lies face-up at rest
            viewDirty = true;
          }
        }
        paint(b, els.current.get(key) ?? null, cubes.current.get(key) ?? null, shadows.current.get(key) ?? null);
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
      {view.map((d) => {
        const fv = cubeFaces(d.finalFace);
        // Every face carries a real <Die>. The front one shows the rolled value and, once
        // rested, its success/crit state + crit pop; the others just show their numbers so the
        // tumble reads as a numbered die. In flight all faces blur together; at rest only the
        // front (now face-up) is visible.
        const renderFace = (side: string, value: DieFace, isFront: boolean) => (
          <div className={`dice-arena__cf dice-arena__cf--${side}${isFront ? "" : ` dice-arena__face--${d.kind}`}`}>
            <div className={`${d.settled ? "" : "dice-arena__flying"}${isFront && d.settled && d.kind === "player" && d.finalFace === 6 ? " crit-pop" : ""}`}>
              <Die
                kind={d.kind}
                value={value}
                state={isFront && d.settled ? (d.kind === "player" ? playerVisual(d.finalFace) : gmVisual(d.finalFace)) : "normal"}
                tilt={0}
                size={`${d.size}px`}
              />
            </div>
          </div>
        );
        return (
          <Fragment key={d.key}>
            <div
              ref={(el) => {
                shadows.current.set(d.key, el);
                const b = bodies.current.get(d.key);
                if (b) paint(b, els.current.get(d.key) ?? null, cubes.current.get(d.key) ?? null, el);
              }}
              className="dice-arena__shadow"
              style={{ width: d.size, height: d.size }}
            />
            <div
              ref={(el) => {
                els.current.set(d.key, el);
                // Place the die at its current physics position the instant it attaches, so it
                // never flashes at the top-left corner before the first animation frame, and so
                // a settle re-render re-applies the rest transform rather than snapping to 0,0.
                const b = bodies.current.get(d.key);
                if (b) paint(b, el, cubes.current.get(d.key) ?? null, shadows.current.get(d.key) ?? null);
              }}
              className="dice-arena__die"
              style={{ width: d.size, height: d.size }}
            >
              {/* A real solid, numbered cube: six <Die> faces under perspective give the tumble
                  true volume and real values, not blank sides. */}
              <div
                ref={(el) => {
                  cubes.current.set(d.key, el);
                  const b = bodies.current.get(d.key);
                  if (b) paint(b, els.current.get(d.key) ?? null, el, shadows.current.get(d.key) ?? null);
                }}
                className="dice-arena__cube"
                style={{ ["--half"]: `${d.size / 2}px` } as CSSProperties}
              >
                {renderFace("front", fv.front, true)}
                {renderFace("back", fv.back, false)}
                {renderFace("right", fv.right, false)}
                {renderFace("left", fv.left, false)}
                {renderFace("top", fv.top, false)}
                {renderFace("bottom", fv.bottom, false)}
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
