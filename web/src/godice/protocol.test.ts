import { describe, it, expect } from "vitest";
import { dieValueFromXyz, parseNotification, preferFlatPending } from "./protocol.js";
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

describe("GoDice settle resolution (preferFlatPending)", () => {
  it("takes the first read whatever its kind", () => {
    expect(preferFlatPending(null, { value: 3, flat: true })).toEqual({ value: 3, flat: true });
    expect(preferFlatPending(null, { value: 3, flat: false })).toEqual({ value: 3, flat: false });
  });

  it("lets a flat read always win — including over an earlier tilt read", () => {
    // Die landed leaning (tilt → adjacent face 2), then settled flat on 5: the flat read replaces it.
    expect(preferFlatPending({ value: 2, flat: false }, { value: 5, flat: true })).toEqual({ value: 5, flat: true });
    // A later flat read also supersedes an earlier flat read (still settling).
    expect(preferFlatPending({ value: 5, flat: true }, { value: 6, flat: true })).toEqual({ value: 6, flat: true });
  });

  it("never lets a tilt/move read clobber a locked-in flat read — the wrong-face fix", () => {
    // Landed flat on 5 (correct), then rocked onto an edge reading 1 (tilt). The flat 5 must stand.
    expect(preferFlatPending({ value: 5, flat: true }, { value: 1, flat: false })).toEqual({ value: 5, flat: true });
  });

  it("lets a tilt/move read stand in only while no flat read has arrived", () => {
    // Two tilt reads, no flat yet: the latest tilt is the best we have.
    expect(preferFlatPending({ value: 2, flat: false }, { value: 4, flat: false })).toEqual({ value: 4, flat: false });
  });
});

describe("GoDice notification parsing", () => {
  it("reads the rolled value off a flat Stable frame", () => {
    const msg = parseNotification(stableFrame(FACE_VECTORS[3]));
    expect(msg).toEqual({ kind: "stable", value: 3, xyz: [0, 64, 0], flat: true });
  });

  it("recognises a Roll Start ('R') frame", () => {
    const dv = new DataView(new Uint8Array([82, 0, 0, 0]).buffer);
    expect(parseNotification(dv)).toEqual({ kind: "roll-start" });
  });

  it("reads tilt ('TS') and move ('MS') rests as less-certain stables (XYZ at offset 2)", () => {
    // 'TS' (84,83) then the value-4 vector [0,-64,0] in bytes 2..4.
    const tiltDv = new DataView(new ArrayBuffer(5));
    tiltDv.setUint8(0, 84);
    tiltDv.setUint8(1, 83);
    tiltDv.setInt8(2, 0);
    tiltDv.setInt8(3, -64);
    tiltDv.setInt8(4, 0);
    expect(parseNotification(tiltDv)).toEqual({ kind: "stable", value: 4, xyz: [0, -64, 0], flat: false });

    // 'MS' (77,83) then the value-6 vector [64,0,0].
    const moveDv = new DataView(new ArrayBuffer(5));
    moveDv.setUint8(0, 77);
    moveDv.setUint8(1, 83);
    moveDv.setInt8(2, 64);
    moveDv.setInt8(3, 0);
    moveDv.setInt8(4, 0);
    expect(parseNotification(moveDv)).toEqual({ kind: "stable", value: 6, xyz: [64, 0, 0], flat: false });
  });

  it("treats the fake stable ('FS'), battery, colour and empty frames as non-readable", () => {
    // 'FS' (70,83) is a *false* stop — the die hasn't really settled, so no value is read.
    const fake = new DataView(new Uint8Array([70, 83, 0, 0, 0]).buffer);
    expect(parseNotification(fake).kind).toBe("other");
    // 'Bat'/'Col' and an empty frame are likewise ignored for capture.
    const battery = new DataView(new Uint8Array([66, 97, 116, 50]).buffer);
    expect(parseNotification(battery).kind).toBe("other");
    expect(parseNotification(new DataView(new ArrayBuffer(0))).kind).toBe("other");
  });
});
