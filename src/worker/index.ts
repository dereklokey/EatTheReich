/// <reference types="@cloudflare/workers-types" />
import { GameRoom } from "./room.js";
import type { Env } from "./room.js";
import { generateJoinCode, normalizeJoinCode } from "../protocol/codes.js";

export { GameRoom };

const JSON_HEADERS = { "content-type": "application/json" };

/**
 * Edge Worker (CLAUDE.md §3.4): mints join codes and routes the `/game/:code`
 * WebSocket upgrade to the room's Durable Object (named by the join code).
 * Everything else is static Pages (the frontend, step 6). Resolving the DO by name
 * is the whole "find the room" step — no separate server or pub/sub.
 *
 *   POST /game        → mint a code, return { code } (client then connects to it)
 *   GET  /game/:code  → WebSocket upgrade, forwarded to that game's DO
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    // Mint a new game code. The DO itself is created lazily on the first connection;
    // minting just hands the client a fresh, hard-to-guess name to connect to.
    if (parts[0] === "game" && parts.length === 1 && request.method === "POST") {
      const code = generateJoinCode();
      return new Response(JSON.stringify({ code }), { headers: JSON_HEADERS });
    }

    if (parts[0] === "game" && parts[1]) {
      // Normalize so case/typos route to the same DO whether minting or joining.
      const code = normalizeJoinCode(parts[1]);
      if (!code) return new Response("invalid game code", { status: 400 });
      const id = env.GAME.idFromName(code);
      return env.GAME.get(id).fetch(request);
    }

    if (parts[0] === "health") return new Response("ok");

    return new Response("Not found", { status: 404 });
  },
};
