import { normalizeJoinCode } from "@shared/protocol/codes.js";

/**
 * Mint a new game (CLAUDE.md §3.6). `POST /game` hits the routing Worker, which
 * generates a hard-to-guess code; the DO itself is created lazily on first connect.
 */
export async function createGame(): Promise<string> {
  const res = await fetch("/game", { method: "POST" });
  if (!res.ok) throw new Error(`could not create game (${res.status})`);
  const body = (await res.json()) as { code: string };
  return body.code;
}

/** Local-side validation mirror of the Worker's route normalization (§3.6). */
export function cleanCode(input: string): string {
  return normalizeJoinCode(input);
}
