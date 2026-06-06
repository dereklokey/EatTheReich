import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState } from "@shared/state/types.js";
import type { Intent } from "@shared/protocol/messages.js";
import type { SeatId } from "@shared/events/types.js";
import { GameConnection, type ConnStatus } from "./connection.js";

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
  mySeat: SeatId | null;
  error: string | null;
  claimSeat: (seat: SeatId) => void;
  releaseSeat: (seat: SeatId) => void;
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

export function useGame(code: string | null): GameView {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [state, setState] = useState<GameState | null>(null);
  const [online, setOnline] = useState<SeatId[]>([]);
  const [mySeat, setMySeat] = useState<SeatId | null>(code ? (loadSeat(code)?.seat ?? null) : null);
  const [error, setError] = useState<string | null>(null);
  const connRef = useRef<GameConnection | null>(null);

  useEffect(() => {
    if (!code) return;
    setMySeat(loadSeat(code)?.seat ?? null);

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
              break;
            case "presence":
              setOnline(m.online);
              break;
            case "seat_granted":
              saveSeat(code, m.seat, m.seatToken);
              setMySeat(m.seat);
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
  const clearError = useCallback(() => setError(null), []);

  return { status, state, online, mySeat, error, claimSeat, releaseSeat, send, clearError };
}
