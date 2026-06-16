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
 * A decoded notification. We only care about the two roll-relevant kinds plus a catch-all:
 *   - `roll-start`  the die was picked up / is tumbling (first byte 'R' = 82). Arms a capture.
 *   - `stable`      the die came to rest flat on a face (first byte 'S' = 83) → carries `value`.
 *   - `other`       battery / colour / tilt-or-edge "stable" — ignored for capture.
 * Tilt/Move/Fake "stable" variants ('TS'/'MS'/'FS') are deliberately `other`: the die isn't flat
 * on a clean face, so we don't want to read a value off it.
 */
export type GoDiceMessage =
  | { kind: "roll-start" }
  | { kind: "stable"; value: DieFace; xyz: [number, number, number] }
  | { kind: "other" };

// Message identifier first bytes (ASCII), from the GoDice JS API.
const MSG_ROLL_START = 82; // 'R'
const MSG_STABLE = 83; // 'S'

/**
 * Parse one TX notification. A genuine `Stable` ('S') frame carries the XYZ vector at bytes
 * 1..3 as signed int8; everything else (including the tilted/edge "stable" frames, which begin
 * with a letter pair) is not a clean face read and comes back as `roll-start` or `other`.
 */
export function parseNotification(data: DataView): GoDiceMessage {
  if (data.byteLength === 0) return { kind: "other" };
  const first = data.getUint8(0);
  if (first === MSG_ROLL_START) return { kind: "roll-start" };
  // A bare 'S' is the flat-rest message; 'FS'/'TS'/'MS' (first byte 70/84/77) are edge/tilt/move
  // variants — not a flat face, so we don't read a value. Require at least the 3 vector bytes.
  if (first === MSG_STABLE && data.byteLength >= 4) {
    const xyz: [number, number, number] = [data.getInt8(1), data.getInt8(2), data.getInt8(3)];
    return { kind: "stable", value: dieValueFromXyz(xyz), xyz };
  }
  return { kind: "other" };
}
