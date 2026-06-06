import { describe, it, expect } from "vitest";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  generateJoinCode,
  normalizeJoinCode,
} from "../codes.js";

describe("generateJoinCode", () => {
  it("uses only the non-ambiguous alphabet and the default length", () => {
    const set = new Set(CODE_ALPHABET);
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode();
      expect(code).toHaveLength(CODE_LENGTH);
      for (const ch of code) expect(set.has(ch)).toBe(true);
    }
  });

  it("excludes the look-alikes 0/O/1/I/L", () => {
    for (const bad of ["0", "O", "1", "I", "L"]) {
      expect(CODE_ALPHABET.includes(bad)).toBe(false);
    }
  });

  it("is deterministic under an injected rng", () => {
    // rng returns the same float each call → same symbol each position.
    const idx = 5;
    const rng = () => idx / CODE_ALPHABET.length;
    expect(generateJoinCode(rng, 4)).toBe(CODE_ALPHABET[idx]!.repeat(4));
  });

  it("walks the alphabet with a sequence rng", () => {
    let i = 0;
    const seq = [0, 1, 2, 3];
    const rng = () => seq[i++]! / CODE_ALPHABET.length;
    expect(generateJoinCode(rng, 4)).toBe(
      CODE_ALPHABET.slice(0, 4),
    );
  });
});

describe("normalizeJoinCode", () => {
  it("upper-cases and strips separators", () => {
    expect(normalizeJoinCode("ab2-cd3")).toBe("AB2CD3");
    expect(normalizeJoinCode("  q r s  ")).toBe("QRS");
  });

  it("drops excluded look-alikes a user might mistype", () => {
    expect(normalizeJoinCode("o0i1lOIL")).toBe(""); // none survive the filter
    expect(normalizeJoinCode("A0B")).toBe("AB");
  });

  it("is idempotent on a freshly minted code", () => {
    const code = generateJoinCode();
    expect(normalizeJoinCode(code)).toBe(code);
    expect(normalizeJoinCode(code.toLowerCase())).toBe(code);
  });
});
