/// <reference types="@cloudflare/workers-types" />
import { DOStore } from "./do-store.js";
import { GameLog, loadState } from "../store/repository.js";
import { applyEvent } from "../state/reducer.js";
import type { GameState } from "../state/types.js";
import { randomRoller } from "../domain/dice.js";
import type { DiceRoller } from "../domain/dice.js";
import { processIntent } from "../protocol/handler.js";
import { authorizeIntent } from "../protocol/authz.js";
import { mintSeatToken, hashSeatToken, verifySeatToken } from "../protocol/seat.js";
import { normalizeJoinCode } from "../protocol/codes.js";
import type { ClientMessage, ServerMessage } from "../protocol/messages.js";
import type { GameEvent, SeatId } from "../events/types.js";

export interface Env {
  GAME: DurableObjectNamespace;
}

/** A seat is shown online if its last heartbeat arrived within this window (§3A). */
const PRESENCE_WINDOW_MS = 60_000;

/** What we stash on each hibernatable socket: the seat it has authenticated as. */
type SocketAttachment = { seat: SeatId };

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
  /**
   * Presence: last-heartbeat timestamp per seat (§3A). Transient in-memory only —
   * never logged, discarded on hibernation, and rebuilt as clients resume
   * heartbeating after a wake. A seat renders online if seen within PRESENCE_WINDOW_MS.
   */
  private lastSeen = new Map<SeatId, number>();

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
    // Normalize to match how the routing Worker resolves the DO name (§3.6).
    const code = normalizeJoinCode(url.pathname.split("/").filter(Boolean).pop() ?? "");
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
    this.sendTo(server, { t: "presence", online: this.onlineSeats() });

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

    // Heartbeat: transient presence only — never logged (§3A). Refresh this seat's
    // last-seen and let everyone re-render the online dots.
    if (msg.t === "heartbeat") {
      const seat = this.seatOf(ws);
      if (seat) {
        this.markSeen(seat);
        this.broadcastPresence();
      }
      return;
    }

    // Reclaim handshake (§3.6/§3A): a returning client proves seat ownership with the
    // raw token it stored. Verify against the stored hash before binding the socket —
    // the seat in the message body is never trusted on its own.
    if (msg.t === "hello") {
      const state = await this.hydrate();
      if (msg.seat && (await verifySeatToken(msg.seatToken, state.seats[msg.seat]?.seatTokenHash))) {
        ws.serializeAttachment({ seat: msg.seat } satisfies SocketAttachment);
        this.markSeen(msg.seat);
      }
      this.sendTo(ws, { t: "sync", state, events: [] });
      this.broadcastPresence();
      return;
    }

    if (msg.t !== "intent") return;

    const state = await this.hydrate();

    // Authority is the socket's authenticated seat, derived from its attachment —
    // never the client-sent `actor` (anti-fudge, §3.1/§3.6).
    const connSeat = this.seatOf(ws);
    const authz = authorizeIntent(state, connSeat, msg.intent);
    if (!authz.ok) {
      this.sendTo(ws, { t: "error", message: authz.error });
      return;
    }

    // GM rewind (§3.2) is a log operation, not an appended event: truncate the log,
    // rebuild, and broadcast the rewound state to everyone.
    if (msg.intent.kind === "rewind") {
      const toSeq = Math.min(state.seq, Math.max(1, Math.floor(msg.intent.toSeq)));
      this.state = await this.log.rewindTo(this.gameId, toSeq);
      this.broadcast({ t: "sync", state: this.state, events: [] });
      return;
    }

    // For a fresh seat claim, mint the raw token here and keep only its hash in the
    // log; the raw token is handed back to this one socket below (§3.6).
    let mintedToken: string | undefined;
    let seatTokenHash: string | undefined;
    if (msg.intent.kind === "claim_seat") {
      mintedToken = mintSeatToken();
      seatTokenHash = await hashSeatToken(mintedToken);
    }

    const result = processIntent(state, msg.intent, {
      roller: this.roller,
      now: Date.now(),
      actor: connSeat ?? "system",
      ...(seatTokenHash ? { seatTokenHash } : {}),
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
        ei.actor ?? connSeat ?? "system",
        ei.type,
        ei.payload as never,
        Date.now(),
      )) as GameEvent;
      next = applyEvent(next, event);
      applied.push(event);
    }
    this.state = next;

    // A successful claim binds this socket to the seat and returns the raw token so
    // the client can persist it for next week's reclaim.
    if (msg.intent.kind === "claim_seat" && mintedToken) {
      const seat = msg.intent.seat;
      ws.serializeAttachment({ seat } satisfies SocketAttachment);
      this.markSeen(seat);
      this.sendTo(ws, { t: "seat_granted", seat, seatToken: mintedToken });
    }

    this.broadcast({ t: "sync", state: next, events: applied });
    this.broadcastPresence();
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

  /** The seat this socket has authenticated as (via claim/reclaim), or null. */
  private seatOf(ws: WebSocket): SeatId | null {
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    return att?.seat ?? null;
  }

  private markSeen(seat: SeatId): void {
    this.lastSeen.set(seat, Date.now());
  }

  /** Seats whose last heartbeat is within the presence window (online/green). */
  private onlineSeats(): SeatId[] {
    const cutoff = Date.now() - PRESENCE_WINDOW_MS;
    const out: SeatId[] = [];
    for (const [seat, ts] of this.lastSeen) {
      if (ts >= cutoff) out.push(seat);
    }
    return out;
  }

  private broadcastPresence(): void {
    this.broadcast({ t: "presence", online: this.onlineSeats() });
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
