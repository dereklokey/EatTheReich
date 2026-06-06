/**
 * Join codes (CLAUDE.md §3.6). A game == one Durable Object named by its join code,
 * and the code IS the access key (no accounts/passwords), so it must carry enough
 * entropy and use a non-ambiguous alphabet that's painless to read aloud / retype.
 *
 * Alphabet excludes the usual look-alikes: no 0/O, 1/I/L. 31 symbols ^ 6 chars
 * ≈ 887 million codes — far more than a friend group will ever mint, so collisions
 * (which would just route two games to the same DO) are negligible.
 */

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

/** Returns a float in [0,1). Injectable so tests are deterministic. */
export type Rng = () => number;

/** Platform CSPRNG-backed rng (works in Workers and Node 20+ via global crypto). */
export function cryptoRng(): Rng {
  return () => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0]! / 0x1_0000_0000;
  };
}

/** Mint a fresh join code from the non-ambiguous alphabet. */
export function generateJoinCode(rng: Rng = cryptoRng(), length = CODE_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  }
  return out;
}

const ALPHABET_SET = new Set(CODE_ALPHABET);

/**
 * Canonicalize a user-typed code so case and stray separators don't route to a
 * different DO: upper-case, then drop anything outside the alphabet (spaces, dashes,
 * and the excluded look-alikes 0/O/1/I/L — a typed look-alike is a misread we can't
 * recover, so we strip it rather than guess). The Worker normalizes both at mint and
 * on the /game/:code route, so case-insensitive joins land on the same DO.
 */
export function normalizeJoinCode(input: string): string {
  let out = "";
  for (const ch of input.toUpperCase()) {
    if (ALPHABET_SET.has(ch)) out += ch;
  }
  return out;
}
