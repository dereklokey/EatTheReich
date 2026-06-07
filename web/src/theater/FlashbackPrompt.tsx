/**
 * The flashback confirmation (RULES §9, rulebook p41). Eat the Reich is played out loud, so
 * there's nothing to type here — the player narrates a moment from a past F.A.N.G. mission at
 * the table. This is just the "are you sure" beat before the reroll commits (issue #9): cut
 * to it and you add 2 dice and roll your whole pool again — the second result stands.
 */
export function FlashbackPrompt({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[74] grid place-items-center p-4 flashback-wash">
      <div className="paper w-full max-w-sm flashback-card text-center">
        <h3 className="display text-2xl">Cut to a flashback?</h3>
        <p className="mono text-xs text-paper-fade mt-2 leading-relaxed">
          Narrate a moment from a past F.A.N.G. mission out loud — then add 2 dice and reroll your
          whole pool. The second result stands; there’s no taking it back.
        </p>
        <div className="mt-5 flex justify-center gap-4">
          <button className="mono text-sm underline text-paper-fade" onClick={onCancel}>not yet</button>
          <button className="display bg-blood text-paper px-5 py-2" style={{ borderRadius: 2 }} onClick={onConfirm}>
            Cut to it
          </button>
        </div>
      </div>
    </div>
  );
}
