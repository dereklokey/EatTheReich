import type { DieFace } from "@shared/domain/types.js";

/**
 * The GoDice Bluetooth LE protocol (issue #50) — the pure, hardware-free half. Constants and
 * byte-parsing only, so it unit-tests without Web Bluetooth or a physical die; the live
 * connection lives in `GoDice.ts`, which builds on this.
 *
 * Reverse-engineered from Particula's official GoDice JavaScript API
 * (github.com/ParticulaCode/GoDiceJavaScriptAPI). GoDice speak over a Nordic UART service:
 * the die streams accelerometer-flavoured notifications on the TX characteristic, and a
 * resting die reports the XYZ gravity vector of its up-face, which maps to a value 1-6.
 */

/** Nordic UART service the dice expose (the GoDice "primary service"). */
export const GODICE_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
/** TX characteristic — the die NOTIFIES on this (rolls, battery, colour). */
export const GODICE_NOTIFY = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
/** RX characteristic — the host WRITES to this (we don't, yet; here for completeness). */
export const GODICE_WRITE = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
/** Every GoDice advertises a name beginning with this — the requestDevice filter. */
export const GODICE_NAME_PREFIX = "GoDice_";

/**
 * The reference up-face gravity vectors for a d6 (signed int8 accelerometer units, ±64 ≈ 1g).
 * The resting die reports its vector; the nearest of these by squared distance is its value.
 * Lifted verbatim from the GoDice JS API's `d6Vectors`.
 */
const D6_VECTORS: Record<DieFace, readonly [number, number, number]> = {
  1: [-64, 0, 0],
  2: [0, 0, 64],
  3: [0, 64, 0],
  4: [0, -64, 0],
  5: [0, 0, -64],
  6: [64, 0, 0],
};

/**
 * Map a resting die's accelerometer vector to its face by nearest reference vector (squared
 * Euclidean distance — no sqrt needed for a comparison). Mirrors the SDK's `getClosestVector`.
 */
export function dieValueFromXyz(xyz: readonly [number, number, number]): DieFace {
  const [x, y, z] = xyz;
  let best: DieFace = 1;
  let bestDist = Number.MAX_SAFE_INTEGER;
  for (const face of [1, 2, 3, 4, 5, 6] as DieFace[]) {
    const [vx, vy, vz] = D6_VECTORS[face];
    const dist = (x - vx) ** 2 + (y - vy) ** 2 + (z - vz) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = face;
    }
  }
  return best;
}

/**
 * A decoded notification. We care about throws plus a catch-all:
 *   - `roll-start`  the die was picked up / is tumbling (first byte 'R' = 82). Arms a capture.
 *   - `stable`      the die came to rest → carries `value`. `flat` is true for a clean flat-face
 *                   rest ('S'), false for the less-certain tilt/move rests ('TS'/'MS'). Both are
 *                   real resting reads worth registering; the caller debounces (so a flat 'S'
 *                   following a bounce wins) and the GM can correct a misread by tapping the slot.
 *   - `other`       battery / colour / the 'fake' stable ('FS', a false stop) — ignored for capture.
 *
 * Reading the tilt/move variants (rather than dropping them, as we first did) is deliberate: a
 * die that lands leaning or gets nudged still reports a face, and silently dropping those reads
 * was a likely cause of "the throw didn't register."
 */
export type GoDiceMessage =
  | { kind: "roll-start" }
  | { kind: "stable"; value: DieFace; xyz: [number, number, number]; flat: boolean }
  | { kind: "other" };

// Message identifier bytes (ASCII), from the GoDice JS API.
const MSG_ROLL_START = 82; // 'R'  — die started moving
const MSG_STABLE = 83; // 'S'  — flat rest (also the 2nd byte of the TS/MS/FS variants)
const MSG_TILT = 84; // 'T' in 'TS' — at rest but tilted / on an edge
const MSG_MOVE = 77; // 'M' in 'MS' — was at rest, then nudged
// 'F' (70) in 'FS' is the *fake* stable — a false stop — and stays `other`.

/**
 * Parse one TX notification. A flat 'S' rest carries XYZ at bytes 1..3; the two-letter tilt/move
 * rests ('TS'/'MS') carry XYZ at bytes 2..4 (after their "x",'S' prefix). All are signed int8.
 * The fake stable ('FS') and the non-roll frames (battery/colour) come back as `other`.
 */
export function parseNotification(data: DataView): GoDiceMessage {
  if (data.byteLength === 0) return { kind: "other" };
  const first = data.getUint8(0);
  if (first === MSG_ROLL_START) return { kind: "roll-start" };
  // Flat rest: 'S' + XYZ at offset 1 — the clean, high-confidence read.
  if (first === MSG_STABLE && data.byteLength >= 4) {
    const xyz: [number, number, number] = [data.getInt8(1), data.getInt8(2), data.getInt8(3)];
    return { kind: "stable", value: dieValueFromXyz(xyz), xyz, flat: true };
  }
  // Tilt/move rest: 'TS'/'MS' + XYZ at offset 2 — a real resting read, just less certain than a
  // flat 'S'. 'FS' (fake stop) is excluded.
  if (data.byteLength >= 5 && data.getUint8(1) === MSG_STABLE && (first === MSG_TILT || first === MSG_MOVE)) {
    const xyz: [number, number, number] = [data.getInt8(2), data.getInt8(3), data.getInt8(4)];
    return { kind: "stable", value: dieValueFromXyz(xyz), xyz, flat: false };
  }
  return { kind: "other" };
}
