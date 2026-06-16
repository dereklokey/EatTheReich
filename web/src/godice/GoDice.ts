import type { DieFace } from "@shared/domain/types.js";
import {
  GODICE_NAME_PREFIX,
  GODICE_NOTIFY,
  GODICE_SERVICE,
  parseNotification,
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
  /** Last face this die came to rest on, or null until it's been thrown. */
  lastValue: DieFace | null;
}

export interface GoDiceRoll {
  deviceId: string;
  value: DieFace;
}

export interface GoDiceListener {
  /** A physical die came to rest on a face after being thrown. */
  onRoll?: (roll: GoDiceRoll) => void;
  /** The connected-dice list or a connection status changed (re-render cue). */
  onChange?: () => void;
  /** ANY traffic from a connected die (movement, rest, battery) — proof it's live right now.
   *  Lets the UI flash a die's tag the instant you wobble it, so "is it connected?" is testable. */
  onActivity?: (deviceId: string) => void;
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
}

function getBluetooth(): WebBluetooth | null {
  const nav = navigator as unknown as { bluetooth?: WebBluetooth };
  return nav.bluetooth ?? null;
}

interface DieEntry {
  device: WBDevice;
  info: GoDieInfo;
  /** Has the die been thrown (roll-start) since its last emitted value? */
  armed: boolean;
}

export class GoDiceManager {
  private readonly entries = new Map<string, DieEntry>();
  private readonly listeners = new Set<GoDiceListener>();

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
    const server = device.gatt;
    if (!server) throw new Error("this device exposes no GATT server");

    await server.connect();
    const service = await server.getPrimaryService(GODICE_SERVICE);
    const notify = await service.getCharacteristic(GODICE_NOTIFY);
    notify.addEventListener("characteristicvaluechanged", (e) => {
      const dv = (e.target as WBCharacteristic).value;
      if (dv) this.handleNotification(device.id, dv);
    });
    await notify.startNotifications();

    const name = (device.name ?? "GoDice").replace(GODICE_NAME_PREFIX, "");
    const info: GoDieInfo = { id: device.id, name, connected: true, lastValue: null };
    // Disarmed until thrown: a die resting since pairing must not inject a phantom face — only a
    // real throw (roll-start → stable) captures. Re-arms on each subsequent roll-start.
    this.entries.set(device.id, { device, info, armed: false });

    device.addEventListener("gattserverdisconnected", () => {
      const entry = this.entries.get(device.id);
      if (entry) {
        entry.info = { ...entry.info, connected: false };
        this.emitChange();
      }
    });

    this.emitChange();
    return info;
  }

  /** Drop every paired die (e.g. when leaving the game). */
  disconnectAll(): void {
    for (const { device } of this.entries.values()) {
      try {
        device.gatt?.disconnect();
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
    if (msg.kind === "roll-start") {
      entry.armed = true;
      return;
    }
    if (msg.kind === "stable" && entry.armed) {
      entry.armed = false;
      entry.info = { ...entry.info, lastValue: msg.value };
      this.emitRoll({ deviceId, value: msg.value });
      this.emitChange();
    }
  }

  private emitRoll(roll: GoDiceRoll): void {
    for (const l of this.listeners) l.onRoll?.(roll);
  }

  private emitActivity(deviceId: string): void {
    for (const l of this.listeners) l.onActivity?.(deviceId);
  }

  private emitChange(): void {
    for (const l of this.listeners) l.onChange?.();
  }
}
