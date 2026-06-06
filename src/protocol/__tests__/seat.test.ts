import { describe, it, expect } from "vitest";
import { mintSeatToken, hashSeatToken, verifySeatToken } from "../seat.js";

describe("seat tokens", () => {
  it("mints distinct, high-entropy hex tokens", () => {
    const a = mintSeatToken();
    const b = mintSeatToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // 32 bytes → 64 hex chars
  });

  it("hashes deterministically and hides the raw token", async () => {
    const token = mintSeatToken();
    const h1 = await hashSeatToken(token);
    const h2 = await hashSeatToken(token);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/); // SHA-256 → 64 hex chars
    expect(h1).not.toBe(token);
  });

  it("verifies a matching token and rejects a wrong one", async () => {
    const token = mintSeatToken();
    const hash = await hashSeatToken(token);
    expect(await verifySeatToken(token, hash)).toBe(true);
    expect(await verifySeatToken(mintSeatToken(), hash)).toBe(false);
  });

  it("rejects when either side is missing (so a no-token reclaim fails closed)", async () => {
    const hash = await hashSeatToken(mintSeatToken());
    expect(await verifySeatToken(undefined, hash)).toBe(false);
    expect(await verifySeatToken("anything", undefined)).toBe(false);
    expect(await verifySeatToken(undefined, undefined)).toBe(false);
  });
});
