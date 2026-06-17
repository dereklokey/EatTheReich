import type { DieFace } from "@shared/domain/types.js";
import {
  GODICE_NAME_PREFIX,
  GODICE_NOTIFY,
  GODICE_SERVICE,
  parseNotification,
  type GoDiceMessage,
} from "./protocol.js";

/**
 * The live GoDice link (issue #50) — the Web Bluetooth half that the pure `protocol.ts` feeds.
 * Owns a set of connected physical dice and turns their notifications into clean "rolled a 4"
 * events. Deliberately tiny: connect, watch for rolls, disconnect. One instance is shared across
 * the app via `GoDiceContext`, so a pairing survives between turns.
 *
 * A die only counts a throw once it's actually moved: a `roll-start` arms the die, the next
 * `stable` (flat-rest) frame emits its value and disarms it. So a die sitting still after pairing
 * never injects a phantom roll, and re-throwing to the same face still registers (it re-arms).
 *
 * Web Bluetooth is Chromium/Edge + HTTPS (or localhost) only; `isSupported()` gates the UI, and
 * `simulateRoll()` exercises the whole capture/animation path with no hardware (the issue's
 * "test it without owning GoDice").
 */

export interface GoDieInfo {
  id: string;
  /** The advertised name (e.g. "GoDice_A1B2"); we trim the prefix for display. */
  name: string;
  connected: boolean;
  /** True while we're auto-retrying a dropped link (die asleep / out of range) — shake to wake. */
  reconnecting: boolean;
  /** Last face this die came to rest on, or null until it's been thrown. */
  lastValue: DieFace | null;
}

export interface GoDiceRoll {
  deviceId: string;
  value: DieFace;
}

/**
 * One raw TX notification, decoded both ways, for the diagnostic harness (issue #50). This is the
 * ground-truth we need to settle "the app shows the wrong face": the bytes the hardware actually
 * sent next to how *we* read them. Only emitted while something is subscribed (the diagnostic),
 * so it costs nothing in normal play.
 */
export interface GoDiceRawFrame {
  deviceId: string;
  /** Bytes exactly as sent (unsigned). */
  bytes: number[];
  /** Same bytes read as signed int8 — the form the XYZ vector uses. */
  signed: number[];
  /** Printable ASCII (non-printables as '.') — surfaces the 'R'/'S'/'TS' identifiers at a glance. */
  ascii: string;
  /** How our parser classified it. */
  kind: GoDiceMessage["kind"];
  /** The decoded gravity vector, for a stable frame. */
  xyz: [number, number, number] | null;
  /** The face our table read from `xyz`, for a stable frame. */
  value: DieFace | null;
  /** True for a clean flat 'S' rest, false for a tilt/move rest, null for non-stable frames. */
  flat: boolean | null;
}

export interface GoDiceListener {
  /** A physical die came to rest on a face after being thrown. */
  onRoll?: (roll: GoDiceRoll) => void;
  /** The connected-dice list or a connection status changed (re-render cue). */
  onChange?: () => void;
  /** ANY traffic from a connected die (movement, rest, battery) — proof it's live right now.
   *  Lets the UI flash a die's tag the instant you wobble it, so "is it connected?" is testable. */
  onActivity?: (deviceId: string) => void;
  /** Every raw frame, decoded both ways — for the diagnostic harness only. */
  onRawFrame?: (frame: GoDiceRawFrame) => void;
}

// --- Minimal Web Bluetooth surface (no @types/web-bluetooth dependency) ---------------------
// Only the handful of members we touch, so the module stays strictly typed and self-contained.
interface WBCharacteristic extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<WBCharacteristic>;
}
interface WBService {
  getCharacteristic(uuid: string): Promise<WBCharacteristic>;
}
interface WBServer {
  connected: boolean;
  connect(): Promise<WBServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<WBService>;
}
interface WBDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: WBServer;
}
interface WBRequestOptions {
  filters?: { namePrefix?: string }[];
  optionalServices?: string[];
}
interface WebBluetooth {
  requestDevice(options: WBRequestOptions): Promise<WBDevice>;
  /** Chromium-only: previously-granted devices, so we can reconnect without re-prompting. */
  getDevices?(): Promise<WBDevice[]>;
}

function getBluetooth(): WebBluetooth | null {
  const nav = navigator as unknown as { bluetooth?: WebBluetooth };
  return nav.bluetooth ?? null;
}

/** A previously-granted die may be asleep / out of range; cap each silent reconnect attempt so
 *  one missing die can't hang the whole batch (gatt.connect has no spec timeout). */
const RECONNECT_TIMEOUT_MS = 8000;

/** A thrown die bounces and rocks before truly settling, sending several stable frames in quick
 *  succession. We keep the LAST face within this quiet window so we report where it came to rest,
 *  not a mid-bounce read — the most likely cause of "the app showed the wrong number." */
const SETTLE_MS = 320;

/** GoDice sleep to save battery; when a link drops we auto-retry so shaking the die wakes it back
 *  into the app. Back off 1→2→4→8→10s (capped) and give up after this many tries (~6 min), after
 *  which the GM can re-trigger with the reconnect button. */
const RECONNECT_BACKOFF_MS = 1000;
const RECONNECT_MAX_INTERVAL_MS = 10000;
const RECONNECT_MAX_ATTEMPTS = 40;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

interface DieEntry {
  device: WBDevice;
  info: GoDieInfo;
  /** Has the die been thrown (roll-start) since its last emitted value? */
  armed: boolean;
  /** The face from the most recent stable frame, awaiting the settle debounce before it emits. */
  pending: DieFace | null;
  /** Fires SETTLE_MS after the last stable frame → emits `pending` as the throw result. */
  settleTimer: ReturnType<typeof setTimeout> | null;
  /** The pending auto-reconnect attempt, if the link has dropped. */
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** We're tearing this die down on purpose (disconnectAll) — don't auto-reconnect it. */
  closing: boolean;
}

export class GoDiceManager {
  private readonly entries = new Map<string, DieEntry>();
  private readonly listeners = new Set<GoDiceListener>();
  /** Device ids we've already bound a `gattserverdisconnected` listener to. The device object
   *  outlives reconnects, so its listener must be added exactly once — not per reconnect. */
  private readonly boundDisconnect = new Set<string>();

  /** Web Bluetooth present (Chromium/Edge, secure context). Test mode works without it. */
  isSupported(): boolean {
    return getBluetooth() !== null;
  }

  subscribe(listener: GoDiceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dice(): GoDieInfo[] {
    return [...this.entries.values()].map((e) => e.info);
  }

  /**
   * Open the browser's pairing chooser and connect the picked die. MUST be called from a user
   * gesture (a click). Resolves with the new die's info; rejects if the user cancels or the
   * connection fails.
   */
  async connect(): Promise<GoDieInfo> {
    const bt = getBluetooth();
    if (!bt) throw new Error("Web Bluetooth isn't available in this browser");

    const device = await bt.requestDevice({
      filters: [{ namePrefix: GODICE_NAME_PREFIX }],
      optionalServices: [GODICE_SERVICE],
    });
    return this.attachDevice(device);
  }

  /** The browser can recall already-granted dice (Chromium's getDevices()) — gates the
   *  one-click "reconnect my dice" path. */
  canReconnect(): boolean {
    const bt = getBluetooth();
    return typeof bt?.getDevices === "function";
  }

  /**
   * Reconnect every previously-granted GoDice with no chooser prompts (issue #50) — the
   * return-visit path, so a 6-die owner pairs each die once *ever*, not once a session. Each die
   * must be awake / in range; out-of-range dice are skipped (a per-die timeout stops one missing
   * die from hanging the batch), and dice we already hold a live link to are left alone. Returns
   * how many dice are connected as a result.
   */
  async reconnectKnown(): Promise<number> {
    const bt = getBluetooth();
    if (typeof bt?.getDevices !== "function") return 0;
    const devices = await bt.getDevices();
    let count = 0;
    for (const device of devices) {
      if (this.entries.get(device.id)?.info.connected) {
        count++;
        continue;
      }
      try {
        await withTimeout(this.attachDevice(device), RECONNECT_TIMEOUT_MS);
        count++;
      } catch {
        // Asleep / out of range / not actually a GoDice — leave it; the GM can wobble + retry.
      }
    }
    return count;
  }

  /** Register a die (once) and open its link. Shared by the pairing flow (connect) and the silent
   *  reconnect (reconnectKnown). The entry + its `gattserverdisconnected` listener are created on
   *  first sight; the actual GATT connect (re-runnable on every wake) lives in `connectGatt`. */
  private async attachDevice(device: WBDevice): Promise<GoDieInfo> {
    const isNew = !this.entries.has(device.id);
    if (isNew) {
      const name = (device.name ?? "GoDice").replace(GODICE_NAME_PREFIX, "");
      // Disarmed until thrown: a die resting since pairing must not inject a phantom face — only a
      // real throw (roll-start → stable) captures. Re-arms on each subsequent roll-start.
      const info: GoDieInfo = { id: device.id, name, connected: false, reconnecting: false, lastValue: null };
      this.entries.set(device.id, {
        device,
        info,
        armed: false,
        pending: null,
        settleTimer: null,
        reconnectTimer: null,
        closing: false,
      });
    }
    // The device object survives reconnects, so bind its disconnect listener exactly once.
    if (!this.boundDisconnect.has(device.id)) {
      this.boundDisconnect.add(device.id);
      device.addEventListener("gattserverdisconnected", () => this.onDisconnected(device.id));
    }
    try {
      await this.connectGatt(device);
    } catch (e) {
      // A first-connect failure shouldn't leave a dead, never-connected entry on the list.
      if (isNew) this.entries.delete(device.id);
      throw e;
    }
    return this.entries.get(device.id)!.info;
  }

  /** Open (or re-open) a die's GATT link and (re)subscribe to its notifications. Re-fetches the
   *  service/characteristic each time, so it works for a fresh pairing and for a post-sleep wake. */
  private async connectGatt(device: WBDevice): Promise<void> {
    const server = device.gatt;
    if (!server) throw new Error("this device exposes no GATT server");

    await withTimeout(server.connect(), RECONNECT_TIMEOUT_MS);
    const service = await server.getPrimaryService(GODICE_SERVICE);
    const notify = await service.getCharacteristic(GODICE_NOTIFY);
    notify.addEventListener("characteristicvaluechanged", (e) => {
      const dv = (e.target as WBCharacteristic).value;
      if (dv) this.handleNotification(device.id, dv);
    });
    await notify.startNotifications();

    const entry = this.entries.get(device.id);
    if (entry) {
      if (entry.reconnectTimer) {
        clearTimeout(entry.reconnectTimer);
        entry.reconnectTimer = null;
      }
      entry.closing = false;
      entry.info = { ...entry.info, connected: true, reconnecting: false };
      this.emitChange();
    }
  }

  /** The link dropped (the die slept, went out of range, or we tore it down). Mark it offline,
   *  abandon any half-finished capture, and — unless we closed it on purpose — start auto-retrying
   *  so a shake brings it back without a manual reconnect. */
  private onDisconnected(deviceId: string): void {
    const entry = this.entries.get(deviceId);
    if (!entry) return;
    if (entry.settleTimer) {
      clearTimeout(entry.settleTimer);
      entry.settleTimer = null;
    }
    entry.pending = null;
    entry.armed = false;
    entry.info = { ...entry.info, connected: false };
    this.emitChange();
    if (!entry.closing) this.scheduleReconnect(deviceId, 0);
  }

  /** Retry a dropped link with capped exponential backoff. Each failed try (die still asleep / out
   *  of range) schedules the next; success flips it back online via `connectGatt`. Gives up after
   *  RECONNECT_MAX_ATTEMPTS so a dead die doesn't retry forever — the GM can re-trigger by hand. */
  private scheduleReconnect(deviceId: string, attempt: number): void {
    const entry = this.entries.get(deviceId);
    if (!entry || entry.closing || entry.info.connected) return;
    if (attempt >= RECONNECT_MAX_ATTEMPTS) {
      entry.info = { ...entry.info, reconnecting: false };
      this.emitChange();
      return;
    }
    entry.info = { ...entry.info, reconnecting: true };
    this.emitChange();
    const delay = Math.min(RECONNECT_BACKOFF_MS * 2 ** Math.min(attempt, 4), RECONNECT_MAX_INTERVAL_MS);
    entry.reconnectTimer = setTimeout(() => {
      const e = this.entries.get(deviceId);
      if (!e || e.closing || e.info.connected) return;
      e.reconnectTimer = null;
      this.connectGatt(e.device).catch(() => this.scheduleReconnect(deviceId, attempt + 1));
    }, delay);
  }

  /** Drop every paired die (e.g. when leaving the game). Flag each as closing so the disconnect
   *  handler doesn't immediately try to auto-reconnect it, and clear any pending timers. */
  disconnectAll(): void {
    for (const entry of this.entries.values()) {
      entry.closing = true;
      if (entry.settleTimer) clearTimeout(entry.settleTimer);
      if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
      try {
        entry.device.gatt?.disconnect();
      } catch {
        /* already gone */
      }
    }
    this.entries.clear();
    this.emitChange();
  }

  /**
   * Inject a synthetic roll — the "test without hardware" path (issue #50). Same code path a
   * real die's `stable` frame takes, so the capture tray and the dice animation behave
   * identically to a physical throw. `value` defaults to a random face.
   */
  simulateRoll(value?: DieFace): void {
    const face = value ?? ((Math.floor(Math.random() * 6) + 1) as DieFace);
    this.emitRoll({ deviceId: "test", value: face });
  }

  private handleNotification(deviceId: string, data: DataView): void {
    const entry = this.entries.get(deviceId);
    if (!entry) return;
    // Any frame at all is proof the die is talking to us right now — surface it for the live
    // "wobble to confirm" cue, regardless of what the frame turns out to be.
    this.emitActivity(deviceId);
    const msg = parseNotification(data);
    this.emitRawFrame(deviceId, data, msg);
    if (msg.kind === "roll-start") {
      entry.armed = true;
      return;
    }
    if (msg.kind !== "stable") return;

    // Take this as a throw result if either: the die was armed by a roll-start (the normal path),
    // or its face changed since the last value we emitted (a missed roll-start — the die clearly
    // moved to a new face, so a throw happened). A die untouched since pairing has lastValue===null
    // and so still can't self-emit a phantom.
    const faceChanged = entry.info.lastValue !== null && msg.value !== entry.info.lastValue;
    if (!entry.armed && !faceChanged) return;

    // Debounce: a die rocks/bounces before truly settling, sending several stable frames. Keep the
    // LAST face within a quiet window so we report where it came to rest, not a mid-bounce read.
    entry.pending = msg.value;
    if (entry.settleTimer) clearTimeout(entry.settleTimer);
    entry.settleTimer = setTimeout(() => this.settleRoll(deviceId), SETTLE_MS);
  }

  /** The die has been quiet for SETTLE_MS after its last stable frame → emit the resting face. */
  private settleRoll(deviceId: string): void {
    const entry = this.entries.get(deviceId);
    if (!entry || entry.pending == null) return;
    const value = entry.pending;
    entry.pending = null;
    entry.settleTimer = null;
    entry.armed = false;
    entry.info = { ...entry.info, lastValue: value };
    this.emitRoll({ deviceId, value });
    this.emitChange();
  }

  private emitRoll(roll: GoDiceRoll): void {
    for (const l of this.listeners) l.onRoll?.(roll);
  }

  private emitActivity(deviceId: string): void {
    for (const l of this.listeners) l.onActivity?.(deviceId);
  }

  /** Build + fan out a raw frame, but only when the diagnostic is actually listening — so normal
   *  play pays nothing for it. */
  private emitRawFrame(deviceId: string, data: DataView, msg: GoDiceMessage): void {
    let listening = false;
    for (const l of this.listeners) {
      if (l.onRawFrame) {
        listening = true;
        break;
      }
    }
    if (!listening) return;

    const bytes: number[] = [];
    const signed: number[] = [];
    for (let i = 0; i < data.byteLength; i++) {
      bytes.push(data.getUint8(i));
      signed.push(data.getInt8(i));
    }
    const ascii = bytes.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    const frame: GoDiceRawFrame = {
      deviceId,
      bytes,
      signed,
      ascii,
      kind: msg.kind,
      xyz: msg.kind === "stable" ? msg.xyz : null,
      value: msg.kind === "stable" ? msg.value : null,
      flat: msg.kind === "stable" ? msg.flat : null,
    };
    for (const l of this.listeners) l.onRawFrame?.(frame);
  }

  private emitChange(): void {
    for (const l of this.listeners) l.onChange?.();
  }
}
