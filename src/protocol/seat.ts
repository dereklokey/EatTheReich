/**
 * Seat tokens (CLAUDE.md §3.6). The durable proof of "this device owns this seat,"
 * surviving weeks via the client's localStorage.
 *
 * Trust model: the **client holds the raw token**; the **server stores only its hash**
 * (in ROLE_CLAIMED.seatTokenHash → SeatState.seatTokenHash). So even someone who can
 * read the event log (replay / audit / spectate) sees only hashes and cannot
 * impersonate a seat. On return the client presents the raw token; the server hashes
 * it and compares. This mirrors how password hashes work.
 *
 * Web Crypto globals (`crypto.getRandomValues`, `crypto.subtle`) exist in both the
 * Workers runtime and Node 20+, so these run unchanged in the DO and under vitest.
 */

const TOKEN_BYTES = 32; // 256 bits of entropy

/** Mint a fresh, high-entropy raw seat token (hex). Returned to the claiming client. */
export function mintSeatToken(): string {
  const buf = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

/** SHA-256 of a raw token, hex-encoded. This is what the server persists. */
export async function hashSeatToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

/**
 * Constant-time-ish comparison of a presented raw token against a stored hash.
 * Returns false for any missing input so callers can pass `seats[seat].seatTokenHash`
 * (which may be undefined) directly.
 */
export async function verifySeatToken(
  token: string | undefined,
  storedHash: string | undefined,
): Promise<boolean> {
  if (!token || !storedHash) return false;
  const got = await hashSeatToken(token);
  return timingSafeEqual(got, storedHash);
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** Length-independent constant-time string compare (both are fixed-length hex here). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
