/// <reference types="@cloudflare/workers-types" />
import { DOStore } from "./do-store.js";
import { GameLog, loadState } from "../store/repository.js";
import { applyEvent } from "../state/reducer.js";
import type { GameState } from "../state/types.js";
import { randomRoller } from "../domain/dice.js";
import type { DiceRoller } from "../domain/dice.js";
import { processIntent } from "../protocol/handler.js";
import type { ClientMessage, ServerMessage } from "../protocol/messages.js";
import type { GameEvent } from "../events/types.js";

export interface Env {
  GAME: DurableObjectNamespace;
}

/** Server-authoritative dice, backed by the platform CSPRNG. */
function cryptoRoller(): DiceRoller {
  return randomRoller(() => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0]! / 0x1_0000_0000;
  });
}

/**
 * One game room = one Durable Object (CLAUDE.md §3.4). It terminates all the room's
 * WebSockets and owns the authoritative state, which lives only in storage between
 * bursts of play.
 *
 * Hibernation (§3.4, non-optional):
 *  - `ctx.acceptWebSocket(ws)` (NOT `ws.accept()`) → the runtime can sleep the
 *    object during inactivity while keeping clients connected → ~$0 between rolls.
 *  - In-memory state is discarded on hibernation, so `hydrate()` rebuilds it from
 *    the latest snapshot + replayed events on first use after construction/wake.
 *  - `webSocketMessage/Close/Error` are the hibernation handler style.
 */
export class GameRoom implements DurableObject {
  private storage: DurableObjectStorage;
  private store: DOStore;
  private log: GameLog;
  private roller: DiceRoller = cryptoRoller();
  private state: GameState | null = null;
  private gameId = "game";

  constructor(private ctx: DurableObjectState, _env: Env) {
    this.storage = ctx.storage;
    this.store = new DOStore(this.storage);
    this.log = new GameLog(this.store, { snapshotEvery: 25 });
  }

  /** Rebuild current state from storage (snapshot + replay) — the wake path. */
  private async hydrate(): Promise<GameState> {
    if (this.state) return this.state;
    const stored = await this.storage.get<string>("meta:gameId");
    if (stored) this.gameId = stored;
    this.state = await loadState(this.store, this.gameId);
    return this.state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // The join code in the path becomes this room's gameId (persisted once).
    const code = url.pathname.split("/").filter(Boolean).pop();
    if (code) {
      const stored = await this.storage.get<string>("meta:gameId");
      if (!stored) {
        await this.storage.put("meta:gameId", code);
        this.gameId = code;
        this.state = null;
      }
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server); // hibernatable accept

    const state = await this.hydrate();
    this.sendTo(server, { t: "sync", state, events: [] });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)) as ClientMessage;
    } catch {
      this.sendTo(ws, { t: "error", message: "malformed message" });
      return;
    }

    if (msg.t === "heartbeat") return; // transient presence — never logged (§3A)

    if (msg.t === "hello") {
      if (msg.seat) ws.serializeAttachment({ seat: msg.seat });
      this.sendTo(ws, { t: "sync", state: await this.hydrate(), events: [] });
      return;
    }

    if (msg.t !== "intent") return;

    const state = await this.hydrate();
    const result = processIntent(state, msg.intent, {
      roller: this.roller,
      now: Date.now(),
      actor: msg.actor ?? "gm",
    });
    if (!result.ok) {
      this.sendTo(ws, { t: "error", message: result.error });
      return;
    }

    const applied: GameEvent[] = [];
    let next = state;
    for (const ei of result.events) {
      // append() is generic; a union `ei.type` widens its return, so re-narrow to
      // GameEvent (the value is a valid union member at runtime).
      const event = (await this.log.append(
        this.gameId,
        ei.actor ?? msg.actor ?? "system",
        ei.type,
        ei.payload as never,
        Date.now(),
      )) as GameEvent;
      next = applyEvent(next, event);
      applied.push(event);
    }
    this.state = next;
    this.broadcast({ t: "sync", state: next, events: applied });
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code, "closing");
    } catch {
      /* already closed */
    }
  }

  async webSocketError(): Promise<void> {
    /* socket dropped; presence rebuilds as clients resume heartbeating (§3A) */
  }

  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket gone */
    }
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        /* skip dead socket */
      }
    }
  }
}
