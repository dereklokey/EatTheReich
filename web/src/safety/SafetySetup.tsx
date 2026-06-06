import { useState, type ReactNode } from "react";
import type { GameState } from "@shared/state/types.js";
import type { Intent } from "@shared/protocol/messages.js";
import { EVIL_CALIBRATION_TIERS, VEIL_DEFAULT_NOTE } from "@shared/data/safety.js";

/**
 * Session-0 safety panel (CLAUDE.md §2, rulebook pp. 6–7 & p68). Collects the table's
 * Lines (never appear) and Veils (no detail) and any Evil-Calibration adjustments,
 * stored on the game and visible to all. Anyone may edit — everyone is responsible for
 * the table's safety. Deliberately plain and serious; never jokey, never gory
 * (DESIGN.md §8).
 *
 * `set_safety` merges per field on the server, so each list edits only its own field.
 */
export function SafetySetup({
  state,
  send,
  onClose,
}: {
  state: GameState;
  send: (i: Intent) => void;
  onClose: () => void;
}) {
  const { lines, veils, calibration } = state.safety;
  return (
    <div className="fixed inset-0 z-[68] flex justify-end">
      <button className="flex-1 bg-night-deep/80" aria-label="close" onClick={onClose} />
      <div className="w-full max-w-md h-full overflow-y-auto bg-night-top border-l border-paper-shadow/40 p-4 pb-24 text-paper">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-2xl font-bold">Safety</h2>
          <button className="font-mono text-sm underline text-paper-fade" onClick={onClose}>close</button>
        </div>
        <p className="font-mono text-xs text-paper-fade mt-2">
          Everyone is responsible for everyone’s safety. Set these together before play; anyone can change
          them at any time, and no reasons are owed.
        </p>

        <EditableList
          title="Lines"
          hint="Elements that don’t appear in the game at all."
          items={lines}
          onChange={(next) => send({ kind: "set_safety", lines: next })}
        />
        <EditableList
          title="Veils"
          hint="Elements that may exist but happen off-screen / without detail."
          items={veils}
          onChange={(next) => send({ kind: "set_safety", veils: next })}
        />

        <section className="mt-6">
          <h3 className="font-mono text-lg font-bold">Evil calibration</h3>
          <p className="font-mono text-xs text-paper-fade mt-1">
            Four degrees of bad behaviour (rulebook p68). Read them together and move points up or down as your
            table prefers; record any adjustments below.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {EVIL_CALIBRATION_TIERS.map((tier, i) => (
              <div key={i} className="border border-paper-shadow/40 p-2">
                <div className="font-mono text-xs font-bold">{i + 1}. {tier.heading}</div>
                <ul className="mt-1 list-disc list-inside">
                  {tier.examples.map((ex, j) => (
                    <li key={j} className="font-mono text-[0.7rem] text-paper-fade">{ex}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="font-mono text-[0.7rem] text-paper-fade italic mt-2">{VEIL_DEFAULT_NOTE}</p>

          <div className="mt-3">
            <EditableList
              title="Our adjustments"
              hint="Anything your table moved, added, or wants to remember."
              items={calibration}
              onChange={(next) => send({ kind: "set_safety", calibration: next })}
              compact
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function EditableList({
  title,
  hint,
  items,
  onChange,
  compact,
}: {
  title: string;
  hint: string;
  items: string[];
  onChange: (next: string[]) => void;
  compact?: boolean;
}): ReactNode {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft("");
  };
  return (
    <section className={compact ? "" : "mt-6"}>
      {!compact && <h3 className="font-mono text-lg font-bold">{title}</h3>}
      {compact && <div className="font-mono text-sm font-bold">{title}</div>}
      <p className="font-mono text-xs text-paper-fade mt-0.5">{hint}</p>

      <ul className="mt-2 flex flex-col gap-1">
        {items.length === 0 && <li className="font-mono text-xs text-paper-fade italic">None set.</li>}
        {items.map((item, i) => (
          <li key={i} className="font-mono text-sm flex items-start gap-2 bg-night-deep/60 px-2 py-1">
            <span className="flex-1">{item}</span>
            <button
              className="text-paper-fade hover:text-blood"
              aria-label={`remove ${item}`}
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex gap-1.5">
        <input
          className="font-mono flex-1 px-2 py-1.5 bg-night-deep/60 text-paper outline-none"
          placeholder={`add a ${title.toLowerCase().replace(/^our /, "").replace(/s$/, "")}…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="font-mono text-sm px-3 bg-paper text-paper-ink" style={{ borderRadius: 3 }} onClick={add}>
          add
        </button>
      </div>
    </section>
  );
}
