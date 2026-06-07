import { useState } from "react";

/**
 * The flashback prompt (RULES §9, rulebook p41). Cut when the active player's roll comes up
 * weak (≤2 successes): they narrate a brief past F.A.N.G. scene, then add 2 dice and reroll
 * the whole pool — the second result stands. It lives on the roll-results screen now (issue
 * #9), so the trigger sits next to the dice it's about to replace, not on the character sheet.
 *
 * Freeform on purpose: pick from the d6 tables at the table or invent one — the app just
 * records what was said. Both fields are required so the narrative beat actually happens.
 */
export function FlashbackPrompt({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (context: string, question: string) => void;
}) {
  const [context, setContext] = useState("");
  const [question, setQuestion] = useState("");
  return (
    <div className="fixed inset-0 z-[74] grid place-items-center p-4 flashback-wash">
      <div className="paper w-full max-w-md flashback-card">
        <h3 className="display text-xl">Flashback</h3>
        <p className="mono text-xs text-paper-fade mt-1">A scene from before. Answer it, then reroll with +2 dice.</p>
        <input className="mono w-full mt-3 px-2 py-1.5 bg-paper-shadow/40" placeholder="context (where/when)" value={context} onChange={(e) => setContext(e.target.value)} />
        <input className="mono w-full mt-2 px-2 py-1.5 bg-paper-shadow/40" placeholder="the question the table asks you" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <button className="mono text-sm underline text-paper-fade" onClick={onCancel}>cancel</button>
          <button className="display bg-blood text-paper px-4 py-1.5" style={{ borderRadius: 2 }} disabled={!context.trim() || !question.trim()} onClick={() => onConfirm(context.trim(), question.trim())}>
            Cut to it
          </button>
        </div>
      </div>
    </div>
  );
}
