import { useState } from "react";
import type { GameState } from "@shared/state/types.js";
import type { Intent } from "@shared/protocol/messages.js";
import type { TrafficColor, GameEvent } from "@shared/events/types.js";
import { SafetySetup } from "@/safety/SafetySetup";
import { LogPanel } from "./LogPanel";
import { useSound } from "@/effects/SoundContext";

/**
 * Safety tooling (CLAUDE.md §2, DESIGN.md §8). The deliberate exception to the
 * spectacle: plain, neutral, never jokey, always one tap away for everyone (GM
 * included). Raising the X-Card broadcasts a calm pause overlay to all clients.
 */
const TRAFFIC: { color: TrafficColor; label: string; css: string }[] = [
  { color: "red", label: "Red", css: "#c0142e" },
  { color: "amber", label: "Amber", css: "#e8941c" },
  { color: "green", label: "Green", css: "#3fbf6a" },
];

export function SafetyBar({ state, send, events }: { state: GameState; send: (i: Intent) => void; events: GameEvent[] }) {
  const { traffic, lines, veils } = state.safety;
  const { enabled: soundOn, toggle: toggleSound } = useSound();
  const [setupOpen, setSetupOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const noted = lines.length + veils.length;

  return (
    <div className="fixed bottom-0 inset-x-0 z-[100] bg-night-deep/95 border-t border-paper-shadow/30">
      <div className="app-w flex items-center gap-3 px-4 py-2">
        <button
          className="font-mono text-sm font-bold px-3 py-1.5 bg-paper text-paper-ink"
          style={{ borderRadius: 3 }}
          onClick={() => send({ kind: "raise_xcard", anonymous: true })}
        >
          ✕ X-Card
        </button>

        {/* Lines & Veils sits beside the X-Card — the two "talk to the table" tools together. */}
        <button
          className="font-mono text-sm px-3 py-1.5 bg-night-top text-paper border border-paper-shadow/40"
          style={{ borderRadius: 3 }}
          onClick={() => setSetupOpen(true)}
        >
          Lines &amp; Veils{noted > 0 ? ` (${noted})` : ""}
        </button>

        <div className="flex items-center gap-1.5">
          {TRAFFIC.map((t) => (
            <button
              key={t.color}
              aria-label={`Signal ${t.label}`}
              onClick={() => send({ kind: "traffic_signal", color: t.color })}
              className="w-6 h-6 rounded-full border-2"
              style={{
                background: t.css,
                borderColor: traffic === t.color ? "#fff" : "transparent",
                opacity: traffic && traffic !== t.color ? 0.45 : 1,
              }}
            />
          ))}
        </div>

        <button
          className="font-mono text-sm px-2 py-1.5 bg-night-top text-paper border border-paper-shadow/40 ml-auto"
          style={{ borderRadius: 3 }}
          aria-label={soundOn ? "mute sound" : "enable sound"}
          title={soundOn ? "mute sound" : "enable sound"}
          onClick={toggleSound}
        >
          {soundOn ? "🔊" : "🔇"}
        </button>
        {/* Event log (issue #18): a squarish chat-bubble glyph — the universal "transcript /
            conversation" affordance — opens the readable log on the right. */}
        <button
          className="font-mono px-2 py-1.5 bg-night-top text-paper border border-paper-shadow/40 grid place-items-center"
          style={{ borderRadius: 3 }}
          aria-label="event log"
          title="Event log"
          onClick={() => setLogOpen(true)}
        >
          <LogGlyph />
        </button>
      </div>

      {setupOpen && <SafetySetup state={state} send={send} onClose={() => setSetupOpen(false)} />}
      {logOpen && <LogPanel state={state} events={events} onClose={() => setLogOpen(false)} />}
    </div>
  );
}

/** A squarish chat bubble with two transcript lines — reads as "conversation / log". */
function LogGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="7" y1="9" x2="15" y2="9" />
      <line x1="7" y1="12.5" x2="12" y2="12.5" />
    </svg>
  );
}

/** The calm pause overlay shown to everyone while the X-Card is raised (§8). */
export function XCardOverlay({ state, send }: { state: GameState; send: (i: Intent) => void }) {
  if (!state.safety.xcardRaised) return null;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-night-deep/96">
      <div className="text-center max-w-sm px-6">
        <p className="font-mono text-2xl text-paper">Paused</p>
        <p className="font-mono text-sm text-paper-fade mt-3">
          Someone asked the table to pause. Take a breath. Talk it through. No reason is owed.
        </p>
        <button
          className="font-mono text-sm mt-6 px-4 py-2 bg-paper text-paper-ink"
          style={{ borderRadius: 3 }}
          onClick={() => send({ kind: "clear_xcard" })}
        >
          Resume when ready
        </button>
      </div>
    </div>
  );
}
