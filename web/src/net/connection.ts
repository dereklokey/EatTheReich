import type { ClientMessage, ServerMessage } from "@shared/protocol/messages.js";

/**
 * Thin WebSocket transport to a game room (CLAUDE.md §3.1/§3A). It owns the socket
 * lifecycle only — heartbeats, reconnect, JSON framing — and hands every decoded
 * ServerMessage to the caller. All authority lives on the server; this never mutates
 * game state, it just relays.
 *
 * Heartbeats (~25s) pause while the tab is hidden so we don't burn requests when no
 * one's looking (§3A); presence is purely heartbeat-driven, never socket-driven.
 */
export type ConnStatus = "connecting" | "open" | "closed";

export interface ConnListeners {
  onMessage: (m: ServerMessage) => void;
  onStatus: (s: ConnStatus) => void;
}

const HEARTBEAT_MS = 25_000;
const RECONNECT_BASE_MS = 800;
const RECONNECT_MAX_MS = 15_000;

function wsUrl(code: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/game/${encodeURIComponent(code)}`;
}

export class GameConnection {
  private ws: WebSocket | null = null;
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private disposed = false;

  constructor(
    private readonly code: string,
    private readonly hello: () => ClientMessage,
    private readonly listeners: ConnListeners,
  ) {}

  connect(): void {
    if (this.disposed) return;
    this.listeners.onStatus("connecting");
    const ws = new WebSocket(wsUrl(this.code));
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.attempts = 0;
      this.send(this.hello());
      this.startHeartbeat();
      this.listeners.onStatus("open");
    });

    ws.addEventListener("message", (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string) as ServerMessage;
      } catch {
        return;
      }
      this.listeners.onMessage(msg);
    });

    ws.addEventListener("close", () => {
      this.stopHeartbeat();
      this.listeners.onStatus("closed");
      this.scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    });

    document.addEventListener("visibilitychange", this.onVisibility);
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    try {
      this.ws?.close();
    } catch {
      /* noop */
    }
    this.ws = null;
  }

  private onVisibility = (): void => {
    // Resume presence the instant the tab is looked at again (§3A).
    if (document.visibilityState === "visible") this.send({ t: "heartbeat" });
  };

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.hbTimer = setInterval(() => {
      if (document.visibilityState === "visible") this.send({ t: "heartbeat" });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.hbTimer) clearInterval(this.hbTimer);
    this.hbTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.attempts++);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
