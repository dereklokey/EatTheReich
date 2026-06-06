import { useState } from "react";
import type { GameState } from "@shared/state/types.js";
import type { Intent } from "@shared/protocol/messages.js";
import type { TrafficColor } from "@shared/events/types.js";
import { SafetySetup } from "@/safety/SafetySetup";
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

export function SafetyBar({ state, send }: { state: GameState; send: (i: Intent) => void }) {
  const { traffic, lines, veils } = state.safety;
  const { enabled: soundOn, toggle: toggleSound } = useSound();
  const [setupOpen, setSetupOpen] = useState(false);
  const noted = lines.length + veils.length;

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-night-deep/95 border-t border-paper-shadow/30">
      <div className="mx-auto max-w-5xl flex items-center gap-3 px-4 py-2">
        <button
          className="font-mono text-sm font-bold px-3 py-1.5 bg-paper text-paper-ink"
          style={{ borderRadius: 3 }}
          onClick={() => send({ kind: "raise_xcard", anonymous: true })}
        >
          ✕ X-Card
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
        <button
          className="font-mono text-sm px-3 py-1.5 bg-night-top text-paper border border-paper-shadow/40"
          style={{ borderRadius: 3 }}
          onClick={() => setSetupOpen(true)}
        >
          Lines &amp; Veils{noted > 0 ? ` (${noted})` : ""}
        </button>
      </div>

      {setupOpen && <SafetySetup state={state} send={send} onClose={() => setSetupOpen(false)} />}
    </div>
  );
}

/** The calm pause overlay shown to everyone while the X-Card is raised (§8). */
export function XCardOverlay({ state, send }: { state: GameState; send: (i: Intent) => void }) {
  if (!state.safety.xcardRaised) return null;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-night-deep/96">
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
