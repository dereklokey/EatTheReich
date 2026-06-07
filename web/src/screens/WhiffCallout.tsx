import { useEffect, useRef, useState } from "react";
import type { GameEvent } from "@shared/events/types.js";
import { useEffects } from "@/effects/EffectsContext";
import { useSound } from "@/effects/SoundContext";
import "./whiff.css";

/**
 * GM-whiff callout (RULES §8, rulebook p38). When the Reich's Attack roll lands zero
 * successes, the anchor Threat presses the attack (+1 Attack) the instant the action
 * concludes — the server emits GM_WHIFF. This watches the session event feed and slams a
 * transient blackletter stamp over the table so the whole table sees *why* that Threat's
 * ATK just ticked up (otherwise it reads as a silent edit).
 *
 * Tone (§7): the nazis fumbled and are now closing in — menacing, not jokey. Mounted at
 * the Game shell so it survives the turn closing. Reduce-effects → a static, un-animated
 * card that still carries the information, auto-dismissed by the same timer.
 */
type Fired = { seq: number; name: string; attack: number };

export function WhiffCallout({ events }: { events: GameEvent[] }) {
  const { reduced } = useEffects();
  const { play } = useSound();
  const lastSeq = useRef(0);
  const [fired, setFired] = useState<Fired | null>(null);

  useEffect(() => {
    let latest: GameEvent | undefined;
    for (const e of events) if (e.type === "GM_WHIFF" && e.seq > lastSeq.current) latest = e;
    if (!latest || latest.type !== "GM_WHIFF") return;
    lastSeq.current = latest.seq;
    setFired({ seq: latest.seq, name: latest.payload.name, attack: latest.payload.attack });
    play("stamp");
    const t = setTimeout(() => setFired(null), reduced ? 2000 : 2600);
    return () => clearTimeout(t);
  }, [events, reduced, play]);

  if (!fired) return null;

  return (
    <div className="whiff-callout" aria-live="polite">
      <div key={fired.seq} className={`whiff-stamp ${reduced ? "" : "whiff-stamp--anim"}`}>
        <div className="whiff-stamp__head gothic">Shots go wide</div>
        <div className="whiff-stamp__sub mono">
          <span className="whiff-stamp__name">{fired.name}</span> presses the attack · ATK +1 →{" "}
          <span className="whiff-stamp__atk">{fired.attack}</span>
        </div>
      </div>
    </div>
  );
}
