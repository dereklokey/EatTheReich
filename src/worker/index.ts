/// <reference types="@cloudflare/workers-types" />
import { GameRoom } from "./room.js";
import type { Env } from "./room.js";

export { GameRoom };

/**
 * Edge Worker (CLAUDE.md §3.4): routes the `/game/:code` WebSocket upgrade to the
 * room's Durable Object (named by the join code). Everything else is static Pages
 * (the frontend, step 6). Resolving the DO by name is the whole "find the room"
 * step — no separate server or pub/sub.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts[0] === "game" && parts[1]) {
      const id = env.GAME.idFromName(parts[1]);
      return env.GAME.get(id).fetch(request);
    }
    if (parts[0] === "health") return new Response("ok");

    return new Response("Not found", { status: 404 });
  },
};
