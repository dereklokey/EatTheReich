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
import type { ClientMessage, ComposerSelection, ServerMessage } from "../protocol/messages.js";
import type { Allocation } from "../engine/allocate.js";
import type { CharId, GameEvent, SeatId } from "../events/types.js";
import { CHAR_IDS } from "../events/types.js";

export interface Env {
  GAME: DurableObjectNamespace;
}

/** A seat is shown online if its last heartbeat arrived within this window (§3A). */
const PRESENCE_WINDOW_MS = 60_000;

/**
 * Idle window before a room self-cleans via an Alarm (§3A, "auto-expiry"). Any activity
 * (a connection or a game event) pushes the deadline out, so an active campaign — even one
 * played in week-apart bursts — never expires; this only reaps genuinely abandoned rooms.
 * Storage is trivially small, so this is hygiene, not necessity.
 */
const EXPIRY_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

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
  /**
   * Transient "who is prepping a turn right now" (the character whose Turn Composer is
   * open on some device), with the authenticated seat that announced it so only that
   * actor — or its socket closing — clears it. In-memory only, never logged, rebuilt as
   * clients re-announce on reconnect; it fills the pre-roll gap before `start_turn` lands
   * so every other client can hide its start controls and show "X is taking a turn".
   */
  private composingSeat: CharId | null = null;
  private composingActor: SeatId | null = null;
  /**
   * Transient live composer preview (issue #47): the active player's in-progress Turn Composer
   * picks (stat / gear / abilities / bonus claims / dice override), streamed so opted-in watchers
   * follow the pre-roll selection live. In-memory only, never logged — purely cosmetic, like
   * `composingSeat`. It rides alongside composing: only the `composingActor` may push it, and it's
   * cleared whenever composing ends (the roll lands, the driver cancels, or the driver drops), so
   * `composePreview !== null` always implies someone is composing.
   */
  private composePreview: ComposerSelection | null = null;
  /**
   * Transient live allocation preview (issue #44): the active player's in-progress dice
   * placements (survivor-indexed, nulls for still-in-tray), with the authenticated seat
   * that announced them so a disconnect can clear it. In-memory only, never logged — the
   * authoritative placement is the `allocate` intent at commit (§3.2). Pushed to clients
   * on connect and cleared when the turn ends or the driver drops, like `composingSeat`.
   */
  private previewAlloc: (Allocation | null)[] | null = null;
  private previewActor: SeatId | null = null;
  /** Serializes webSocket message handling (see webSocketMessage). */
  private tail: Promise<void> = Promise.resolve();

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
    await this.touch(); // a connection is activity — push the auto-expiry deadline out (§3A)
    this.sendTo(server, { t: "sync", state, events: [] });
    this.sendTo(server, { t: "presence", online: this.onlineSeats() });
    this.sendTo(server, { t: "composing", seat: this.composingSeat });
    if (this.previewAlloc) this.sendTo(server, { t: "alloc_preview", allocations: this.previewAlloc });
    if (this.composePreview) this.sendTo(server, { t: "compose_preview", selection: this.composePreview });

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Record activity and (re)arm the idle-expiry Alarm (§3A). */
  private async touch(): Promise<void> {
    await this.storage.put("meta:lastActivity", Date.now());
    await this.storage.setAlarm(Date.now() + EXPIRY_MS);
  }

  /**
   * Idle-expiry Alarm (§3A). Fires EXPIRY_MS after the last `touch()`; if there's been
   * activity since the alarm was armed, it just reschedules — so only a room untouched for
   * the full window is wiped. deleteAll() also drops the meta/snapshot/event keys.
   */
  async alarm(): Promise<void> {
    const last = (await this.storage.get<number>("meta:lastActivity")) ?? 0;
    if (Date.now() - last >= EXPIRY_MS) {
      await this.storage.deleteAll();
      await this.storage.deleteAlarm();
      this.state = null;
      this.broadcast({ t: "deleted" });
    } else {
      await this.storage.setAlarm(last + EXPIRY_MS);
    }
  }

  /**
   * Serialize ALL message handling through one promise chain. Two intents sent
   * back-to-back (e.g. the allocation tray's `allocate` then `commit`) arrive as two
   * `webSocketMessage` invocations; without this they could interleave at their
   * `await` points and collide on seq assignment, so the second append throws and its
   * effect (clearing the turn) is lost. The queue guarantees strict one-at-a-time
   * processing — the server-authoritative, append-in-order contract (§3.1).
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.tail = this.tail.then(() => this.handleMessage(ws, message)).catch(() => {});
    return this.tail;
  }

  private async handleMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
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

    // "I'm prepping a turn" — transient, never logged (§3A). Announce who currently has
    // the Composer open so every client can show "X is taking a turn" and hide its start
    // controls during the pre-roll gap. Anti-fudge: a player may only speak for their own
    // seat; the GM may prep any character. A null seat clears, but only the actor that set
    // it (matched by authenticated seat) may clear it — a stale message can't unblock the
    // table mid-prep.
    if (msg.t === "composing") {
      const conn = this.seatOf(ws);
      if (!conn) return;
      if (msg.seat === null) {
        if (this.composingActor === conn) this.setComposing(null, null);
        return;
      }
      // A seat that already took its turn this round (or is dead), or one announcing while a turn
      // is already live, can't be "about to take a turn" — RULES §1 is one turn per character per
      // round. Ignore such a (stale) arm so a late announce can't strand the banner and block the
      // table after a completed turn (#46), nor re-arm it on top of an in-progress turn (#50).
      const acted = this.state?.actedThisRound.includes(msg.seat) || this.state?.characters[msg.seat]?.dead;
      const live = !!this.state?.currentTurn;
      const valid = CHAR_IDS.includes(msg.seat) && (conn === "gm" || conn === msg.seat) && !acted && !live;
      if (valid) this.setComposing(msg.seat, conn);
      return;
    }

    // Live allocation preview (issue #44) — transient, never logged. The active player's
    // in-progress placements, fanned out so every watcher sees the dice land before commit.
    // Anti-fudge: only the seat whose turn it is (or the GM) may drive the preview, and it's
    // never reduced into state — the authoritative placement is the `allocate` intent at commit.
    if (msg.t === "alloc_preview") {
      const conn = this.seatOf(ws);
      const turn = this.state?.currentTurn;
      if (!conn || !turn || (conn !== turn.seat && conn !== "gm")) return;
      this.setPreview(msg.allocations, conn);
      return;
    }

    // Live composer preview (issue #47) — transient, never logged. The active player's in-progress
    // Turn Composer picks, streamed so opted-in watchers follow the pre-roll selection. Anti-fudge:
    // only the device that announced `composing` (composingActor) may push it, so a non-driver can't
    // spoof someone else's pool. Cleared with composing (setComposing), so it never outlives the prep.
    if (msg.t === "compose_preview") {
      const conn = this.seatOf(ws);
      if (conn && conn === this.composingActor) this.setComposePreview(msg.selection);
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
      this.sendTo(ws, { t: "composing", seat: this.composingSeat });
      if (this.previewAlloc) this.sendTo(ws, { t: "alloc_preview", allocations: this.previewAlloc });
      if (this.composePreview) this.sendTo(ws, { t: "compose_preview", selection: this.composePreview });
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

    // GM "finish & delete game" (§3A) — also a log op, not an event: wipe the room's
    // storage and tell every client to clear its seat and return to the start screen.
    if (msg.intent.kind === "delete_game") {
      await this.storage.deleteAll();
      await this.storage.deleteAlarm();
      this.state = null;
      this.broadcast({ t: "deleted" });
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
    await this.touch(); // game activity — refresh the auto-expiry deadline (§3A)

    // The pre-roll "taking a turn" pointer (§3A) only means anything in the gap before a turn
    // exists. Drop it whenever a turn is now in progress (the roll landed — a lost client-side
    // clear mustn't strand it) OR a turn just ended (commit/cancel/death/last-stand). Without
    // the turn-END clear, a `composing` announce that races the turn-ending intent stays armed
    // with no recovery path and hides every client's start controls, blocking the next turn (#46).
    const turnStarted = !state.currentTurn && !!next.currentTurn;
    const turnEnded = !!state.currentTurn && !next.currentTurn;
    if (this.composingSeat && (next.currentTurn || turnEnded)) {
      this.setComposing(null, null);
    } else if (turnStarted || turnEnded) {
      // The in-memory pointer is already null here — but it may have been LOST to a hibernation
      // (the DO forgets who was composing on wake, §3.4) while connected clients kept their
      // mirror and never received a clear delta. A turn going live or ending is the moment that
      // mirror is provably stale, so force a reconcile broadcast even though setComposing would
      // otherwise no-op on an already-null pointer — otherwise the banner strands (#50).
      this.broadcast({ t: "composing", seat: null });
    }
    // The live allocation preview (#44) only means anything during the open turn's ALLOCATE.
    // Drop it when the turn ends (commit/cancel/death) so the next turn starts with a clean
    // tray and a mid-allocation reconnect can't inherit a stale overlay.
    if (this.previewAlloc && turnEnded) this.setPreview(null, null);

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
    // If the device that was prepping a turn drops, release the "taking a turn" signal so
    // the table isn't left waiting on a composer that's gone (§3A — transient, no log).
    if (this.composingActor && this.seatOf(ws) === this.composingActor) {
      this.setComposing(null, null);
    }
    // Likewise drop the live allocation preview (#44) if the driver that was placing dice
    // drops, so watchers aren't left staring at a frozen half-allocation (§3A — transient).
    if (this.previewActor && this.seatOf(ws) === this.previewActor) {
      this.setPreview(null, null);
    }
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

  /** Set (or clear, with nulls) the transient "taking a turn" pointer and tell the room. */
  private setComposing(seat: CharId | null, actor: SeatId | null): void {
    if (this.composingSeat === seat && this.composingActor === actor) return;
    this.composingSeat = seat;
    this.composingActor = actor;
    this.broadcast({ t: "composing", seat });
    // The composer preview (#47) lives only while someone is composing — drop it when prep ends,
    // so a watcher can't be left staring at a frozen pre-roll loadout after the turn rolls/cancels.
    if (seat === null && this.composePreview !== null) this.setComposePreview(null);
  }

  /** Set (or clear, with null) the transient live composer preview (#47) and fan it out. */
  private setComposePreview(selection: ComposerSelection | null): void {
    this.composePreview = selection;
    this.broadcast({ t: "compose_preview", selection });
  }

  /**
   * Set (or clear, with null) the transient live allocation preview (#44) and fan it out.
   * On clear we broadcast an empty array so watchers' trays reset to all-in-the-pool.
   */
  private setPreview(allocations: (Allocation | null)[] | null, actor: SeatId | null): void {
    this.previewAlloc = allocations;
    this.previewActor = actor;
    this.broadcast({ t: "alloc_preview", allocations: allocations ?? [] });
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
