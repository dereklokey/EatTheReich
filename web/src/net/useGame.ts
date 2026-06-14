import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState } from "@shared/state/types.js";
import type { Intent, ComposerSelection } from "@shared/protocol/messages.js";
import type { Allocation } from "@shared/engine/allocate.js";
import type { SeatId, CharId, GameEvent } from "@shared/events/types.js";
import { GameConnection, type ConnStatus } from "./connection.js";

/** How many recent events the client keeps for the GM rewind feed. */
const FEED_CAP = 60;

/**
 * React binding over GameConnection (CLAUDE.md §3.4: "a single client-side reducer
 * mirrors server state"). The server is authoritative and pushes the full GameState
 * on every change, so the mirror is simply "adopt the latest snapshot" — no local
 * dice math. Presence is a transient online-seat list (§3A).
 *
 * Seat ownership is durable across weeks via a localStorage seatToken (§3.6): on a
 * fresh claim the server returns the raw token (seat_granted) which we persist; on
 * return we present it in the `hello` handshake to be auto-seated.
 */
export interface GameView {
  status: ConnStatus;
  state: GameState | null;
  online: SeatId[];
  /** Transient: the character whose Turn Composer is currently open (pre-roll), or null (§3A). */
  composingSeat: CharId | null;
  /** Transient: the active player's in-progress dice placements (survivor-indexed), or null when
   *  nobody is allocating (issue #44). Watchers mirror this to see the spectacle land live. */
  allocPreview: (Allocation | null)[] | null;
  /** Transient: the active player's in-progress Turn Composer picks, or null when nobody is
   *  composing (issue #47). Opted-in watchers mirror this to follow the pre-roll selection. */
  composePreview: ComposerSelection | null;
  mySeat: SeatId | null;
  error: string | null;
  /** Recent events accumulated this session, for the GM rewind feed (§3.2). */
  events: GameEvent[];
  /** True once the GM has finished & deleted this game (§3A) — the room is gone. */
  deleted: boolean;
  claimSeat: (seat: SeatId) => void;
  releaseSeat: (seat: SeatId) => void;
  rewind: (toSeq: number) => void;
  deleteGame: () => void;
  /** Announce (or clear, with null) that this device has the Composer open for `seat` (§3A). */
  setComposing: (seat: CharId | null) => void;
  /** Broadcast this device's in-progress dice placements while driving allocation (issue #44). */
  sendAllocPreview: (allocations: (Allocation | null)[]) => void;
  /** Broadcast this device's in-progress Turn Composer picks while driving the prep (issue #47). */
  sendComposePreview: (selection: ComposerSelection) => void;
  send: (intent: Intent) => void;
  clearError: () => void;
}

interface StoredSeat {
  seat: SeatId;
  token: string;
}

const seatKey = (code: string) => `etr.seat.${code}`;

function loadSeat(code: string): StoredSeat | null {
  try {
    const raw = localStorage.getItem(seatKey(code));
    return raw ? (JSON.parse(raw) as StoredSeat) : null;
  } catch {
    return null;
  }
}

function saveSeat(code: string, seat: SeatId, token: string): void {
  localStorage.setItem(seatKey(code), JSON.stringify({ seat, token } satisfies StoredSeat));
}

function clearSeat(code: string): void {
  localStorage.removeItem(seatKey(code));
}

export function useGame(code: string | null): GameView {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [state, setState] = useState<GameState | null>(null);
  const [online, setOnline] = useState<SeatId[]>([]);
  const [composingSeat, setComposingSeat] = useState<CharId | null>(null);
  const [allocPreview, setAllocPreview] = useState<(Allocation | null)[] | null>(null);
  const [composePreview, setComposePreview] = useState<ComposerSelection | null>(null);
  const [mySeat, setMySeat] = useState<SeatId | null>(code ? (loadSeat(code)?.seat ?? null) : null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [deleted, setDeleted] = useState(false);
  const connRef = useRef<GameConnection | null>(null);

  useEffect(() => {
    if (!code) return;
    setMySeat(loadSeat(code)?.seat ?? null);
    setEvents([]);
    setComposingSeat(null);
    setAllocPreview(null);
    setComposePreview(null);
    setDeleted(false);

    const conn = new GameConnection(
      code,
      () => {
        const s = loadSeat(code);
        return s ? { t: "hello", seat: s.seat, seatToken: s.token } : { t: "hello" };
      },
      {
        onStatus: setStatus,
        onMessage: (m) => {
          switch (m.t) {
            case "sync":
              setState(m.state);
              // Accumulate the event feed, dedupe by seq, and prune anything past the
              // current head so a GM rewind (which truncates the log) prunes here too.
              setEvents((prev) => {
                const bySeq = new Map(prev.map((e) => [e.seq, e]));
                for (const e of m.events) bySeq.set(e.seq, e);
                return [...bySeq.values()]
                  .filter((e) => e.seq <= m.state.seq)
                  .sort((a, b) => a.seq - b.seq)
                  .slice(-FEED_CAP);
              });
              break;
            case "presence":
              setOnline(m.online);
              break;
            case "composing":
              setComposingSeat(m.seat);
              break;
            case "alloc_preview":
              // A non-empty array is the driver's live placements; an empty array is the
              // server's clear signal (turn ended / driver dropped) — collapse to null (#44).
              setAllocPreview(m.allocations.length ? m.allocations : null);
              break;
            case "compose_preview":
              // The driver's live Turn Composer picks (issue #47), or null when the server
              // clears it as composing ends (roll/cancel/drop). Opted-in watchers mirror it.
              setComposePreview(m.selection);
              break;
            case "seat_granted":
              saveSeat(code, m.seat, m.seatToken);
              setMySeat(m.seat);
              break;
            case "deleted":
              // The GM finished & deleted the room (§3A): drop our seat token (it points at
              // storage that no longer exists) and surface the ended state.
              clearSeat(code);
              setMySeat(null);
              setDeleted(true);
              break;
            case "error":
              setError(m.message);
              break;
          }
        },
      },
    );
    connRef.current = conn;
    conn.connect();
    return () => {
      conn.dispose();
      connRef.current = null;
    };
  }, [code]);

  const send = useCallback((intent: Intent) => {
    connRef.current?.send({ t: "intent", intent });
  }, []);

  const claimSeat = useCallback((seat: SeatId) => send({ kind: "claim_seat", seat }), [send]);
  const releaseSeat = useCallback((seat: SeatId) => send({ kind: "release_seat", seat }), [send]);
  const rewind = useCallback((toSeq: number) => send({ kind: "rewind", toSeq }), [send]);
  const deleteGame = useCallback(() => send({ kind: "delete_game" }), [send]);
  const setComposing = useCallback((seat: CharId | null) => connRef.current?.send({ t: "composing", seat }), []);
  const sendAllocPreview = useCallback((allocations: (Allocation | null)[]) => connRef.current?.send({ t: "alloc_preview", allocations }), []);
  const sendComposePreview = useCallback((selection: ComposerSelection) => connRef.current?.send({ t: "compose_preview", selection }), []);
  const clearError = useCallback(() => setError(null), []);

  return { status, state, online, composingSeat, allocPreview, composePreview, mySeat, error, events, deleted, claimSeat, releaseSeat, rewind, deleteGame, setComposing, sendAllocPreview, sendComposePreview, send, clearError };
}
