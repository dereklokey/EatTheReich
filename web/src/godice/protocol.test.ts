import { describe, it, expect } from "vitest";
import { dieValueFromXyz, parseNotification } from "./protocol.js";
import type { DieFace } from "@shared/domain/types.js";

/** Build a 'Stable' ('S' = 83) notification carrying a signed-int8 XYZ vector. */
function stableFrame(xyz: [number, number, number]): DataView {
  const buf = new ArrayBuffer(4);
  const dv = new DataView(buf);
  dv.setUint8(0, 83);
  dv.setInt8(1, xyz[0]);
  dv.setInt8(2, xyz[1]);
  dv.setInt8(3, xyz[2]);
  return dv;
}

// The reference up-face vectors (the SDK's d6Vectors) — each must read back as its face.
const FACE_VECTORS: Record<DieFace, [number, number, number]> = {
  1: [-64, 0, 0],
  2: [0, 0, 64],
  3: [0, 64, 0],
  4: [0, -64, 0],
  5: [0, 0, -64],
  6: [64, 0, 0],
};

describe("GoDice vector→value mapping", () => {
  it("maps each reference vector to its own face", () => {
    for (const face of [1, 2, 3, 4, 5, 6] as DieFace[]) {
      expect(dieValueFromXyz(FACE_VECTORS[face])).toBe(face);
    }
  });

  it("tolerates real-world accelerometer noise (nearest vector wins)", () => {
    // A die resting on face 6 won't report a perfect [64,0,0] — there's slop.
    expect(dieValueFromXyz([58, -7, 9])).toBe(6);
    expect(dieValueFromXyz([3, -61, -6])).toBe(4);
    expect(dieValueFromXyz([-60, 8, -4])).toBe(1);
  });
});

describe("GoDice notification parsing", () => {
  it("reads the rolled value off a Stable frame", () => {
    const msg = parseNotification(stableFrame(FACE_VECTORS[3]));
    expect(msg).toEqual({ kind: "stable", value: 3, xyz: [0, 64, 0] });
  });

  it("recognises a Roll Start ('R') frame", () => {
    const dv = new DataView(new Uint8Array([82, 0, 0, 0]).buffer);
    expect(parseNotification(dv)).toEqual({ kind: "roll-start" });
  });

  it("treats tilt/move/edge 'stable' variants as non-readable", () => {
    // 'TS' (84,83) is a tilted rest — the die isn't flat on a face, so no value is read.
    const tilt = new DataView(new Uint8Array([84, 83, 0, 0]).buffer);
    expect(parseNotification(tilt).kind).toBe("other");
    // 'Bat'/'Col' and an empty frame are likewise ignored for capture.
    const battery = new DataView(new Uint8Array([66, 97, 116, 50]).buffer);
    expect(parseNotification(battery).kind).toBe("other");
    expect(parseNotification(new DataView(new ArrayBuffer(0))).kind).toBe("other");
  });
});
