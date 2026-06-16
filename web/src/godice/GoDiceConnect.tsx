import { useEffect, useRef, useState } from "react";
import { useGoDice } from "./GoDiceContext.js";
import "./godice.css";

/**
 * The connect / connected-dice strip (issue #50) — pair, reconnect, and read live status. Shared
 * by the Reich-roll capture panel and the header indicator's popover, so dice can be set up
 * before a turn as well as during one.
 *
 * Each paired die shows a steady status dot (green = connected, grey = dropped) and flashes the
 * instant it sends any traffic — so "is it actually connected?" is answerable: wobble the die and
 * watch its tag pulse.
 */
export function GoDiceConnect() {
  const goDice = useGoDice();
  const connectedCount = goDice.dice.filter((d) => d.connected).length;

  // Per-die "talking right now" flash. Any frame from a die (movement/rest/battery) lights its
  // tag for a beat, then fades — proof of a live link, separate from the steady connected dot.
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const stored = timers.current;
    const unsub = goDice.subscribeActivity((id) => {
      setActiveIds((cur) => (cur.has(id) ? cur : new Set(cur).add(id)));
      const existing = stored.get(id);
      if (existing) clearTimeout(existing);
      stored.set(
        id,
        setTimeout(() => {
          stored.delete(id);
          setActiveIds((cur) => {
            const next = new Set(cur);
            next.delete(id);
            return next;
          });
        }, 1100),
      );
    });
    return () => {
      unsub();
      for (const t of stored.values()) clearTimeout(t);
      stored.clear();
    };
  }, [goDice]);

  const connectBtn = goDice.supported && (
    <button
      className={connectedCount === 0 ? "reichroll__btn" : "reichroll__link"}
      disabled={goDice.connecting}
      onClick={() => void goDice.connect()}
    >
      {goDice.connecting ? "pairing…" : connectedCount === 0 ? "Connect a die" : "+ add die"}
    </button>
  );
  // One click brings back every die granted in a past session — no re-picking each one.
  const reconnectBtn = goDice.supported && goDice.canReconnect && (
    <button className="reichroll__link" disabled={goDice.connecting} onClick={() => void goDice.reconnect()}>
      {goDice.connecting ? "reconnecting…" : "⟳ reconnect my dice"}
    </button>
  );

  return (
    <div className="reichroll__connect">
      {goDice.dice.length === 0 ? (
        goDice.supported ? (
          <>
            {connectBtn}
            {reconnectBtn}
            {goDice.canReconnect && (
              <span className="reichroll__hint">Paired before? “Reconnect my dice” skips re-picking each one.</span>
            )}
          </>
        ) : (
          <span className="reichroll__hint">Web Bluetooth isn’t available here — use Chrome or Edge to pair GoDice.</span>
        )
      ) : (
        <>
          <div className="reichroll__dice-list">
            {goDice.dice.map((d) => (
              <span
                key={d.id}
                className={`reichroll__die-chip ${d.connected ? "" : "reichroll__die-chip--dropped"} ${activeIds.has(d.id) ? "reichroll__die-chip--live" : ""}`}
                title={d.connected ? `${d.name} — connected` : `${d.name} — link lost`}
              >
                <span className={`reichroll__chip-dot ${d.connected ? "is-on" : "is-off"}`} />
                {d.name}
                {d.lastValue != null && <b> · {d.lastValue}</b>}
              </span>
            ))}
            {connectBtn}
            {reconnectBtn}
          </div>
          <span className="reichroll__hint">
            {connectedCount > 0
              ? "Wobble a die to confirm — its tag flashes when it’s talking to the app."
              : "Link lost — reconnect to bring them back."}
          </span>
        </>
      )}
      {goDice.error && <span className="reichroll__err">{goDice.error}</span>}
    </div>
  );
}
